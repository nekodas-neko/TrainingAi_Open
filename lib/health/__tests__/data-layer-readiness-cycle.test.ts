// Release test for 1.525.0 (20 Nov): `@/lib/data` must never reach `readiness-payload.ts`, and (#3916)
// must never reach any module that imports `@/lib/data` back.
//
// `readiness-payload` imports `@/lib/data`. When the data layer reached it back (adapter →
// rescore-nights → night-readiness ⇢ readiness-payload, the last edge a dynamic import), Turbopack on
// `pnpm dev` evaluated the cycle with `@/lib/data` still empty, and `/api/readiness-score` returned
// 500 with "getRepository is not a function". A dynamic import does not break such a cycle, so this
// walks static AND dynamic imports (type-only ones are erased and skipped) from `lib/data/index.ts`.
// Today's scorer is injected by the callers outside the data layer instead
// (`lib/health/today-readiness-scorer.ts`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(__dirname, '../../..')
const ENTRY = path.join(ROOT, 'lib/data/index.ts')
const FORBIDDEN = path.join(ROOT, 'lib/health/readiness-payload.ts')

function resolveSpecifier(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('@trainingai/shared/')) base = path.join(ROOT, 'packages/shared/src', spec.slice('@trainingai/shared/'.length))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null // a package: never our code
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (/\.tsx?$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Runtime imports of a file: static, re-exports, `import()` and `require()`. Type-only ones are erased. */
function runtimeImports(file: string): string[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(e => e.isTypeOnly))
      if (!typeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) out.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return out
}

/** The import path from `entry` to `target`, or null when `target` is unreachable. */
export function importPath(entry: string, target: string): string[] | null {
  const parent = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (file === target) {
      const chain: string[] = []
      for (let f: string | null = file; f; f = parent.get(f) ?? null) chain.unshift(path.relative(ROOT, f))
      return chain
    }
    for (const spec of runtimeImports(file)) {
      const next = resolveSpecifier(spec, file)
      if (next && !parent.has(next)) { parent.set(next, file); queue.push(next) }
    }
  }
  return null
}

/** Every file `entry` reaches, each with the file that first imported it. */
function reachable(entry: string): Map<string, string | null> {
  const parent = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    for (const spec of runtimeImports(file)) {
      const next = resolveSpecifier(spec, file)
      if (next && !parent.has(next)) { parent.set(next, file); queue.push(next) }
    }
  }
  return parent
}

/**
 * #3916: the whole class, not one file. Every module reachable from `from` (by default the data
 * layer itself) that imports `lib/data/index.ts` (statically or through `import()`), each with the
 * chain that reaches it. Walked from the data layer, any hit is a cycle.
 */
export function importersOfDataLayer(from: string = ENTRY): string[] {
  const parent = reachable(from)
  const out: string[] = []
  for (const file of parent.keys()) {
    if (file === ENTRY) continue
    if (!runtimeImports(file).some(spec => resolveSpecifier(spec, file) === ENTRY)) continue
    const chain: string[] = []
    for (let f: string | null = file; f; f = parent.get(f) ?? null) chain.unshift(path.relative(ROOT, f))
    out.push(`${chain.join(' → ')} ⇢ lib/data/index.ts`)
  }
  return out
}

describe('the data layer never reaches the readiness read', () => {
  it('finds the path when one exists (the walk works)', () => {
    expect(importPath(FORBIDDEN, ENTRY)).not.toBeNull()
  })

  it('lib/data/index.ts cannot reach lib/health/readiness-payload.ts by static or dynamic import', () => {
    expect(importPath(ENTRY, FORBIDDEN)).toBeNull()
  })
})

describe('the data layer never reaches a module that imports it back (#3916)', () => {
  it('finds such a module when one exists (the walk works)', () => {
    // Walked from a route instead, the wrapper that looks the repository up is an importer, and the
    // dynamic `import('@/lib/data')` in the log-exercise wrapper is seen too.
    expect(importersOfDataLayer(path.join(ROOT, 'app/api/workout-sessions/route.ts')).join('\n'))
      .toContain('lib/workout/delete-session-reconcile.ts ⇢')
    expect(importersOfDataLayer(path.join(ROOT, 'app/api/log-exercise/route.ts')).join('\n'))
      .toContain('packages/shared/src/workout/log-exercise.ts ⇢')
  })

  it('nothing lib/data/index.ts reaches imports @/lib/data, statically or through import()', () => {
    // A cycle here is #3911's bug: under `pnpm dev` the route's `@/lib/data` can come up empty
    // ("getRepository is not a function"). Pass the repository in from outside the data layer
    // instead (the `*-core` modules in lib/workout and packages/shared/src/workout do).
    expect(importersOfDataLayer()).toEqual([])
  })
})
