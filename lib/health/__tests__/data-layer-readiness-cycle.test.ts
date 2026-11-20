// Release test for 1.525.0 (20 Nov): `@/lib/data` must never reach `readiness-payload.ts`.
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

describe('the data layer never reaches the readiness read', () => {
  it('finds the path when one exists (the walk works)', () => {
    expect(importPath(FORBIDDEN, ENTRY)).not.toBeNull()
  })

  it('lib/data/index.ts cannot reach lib/health/readiness-payload.ts by static or dynamic import', () => {
    expect(importPath(ENTRY, FORBIDDEN)).toBeNull()
  })
})
