#!/usr/bin/env node
/**
 * Every repo path CLAUDE.md names must exist.
 *
 * CLAUDE.md is the first thing every session reads, and it is read as instruction rather than as
 * prose. When the monorepo extraction moved nine modules to `packages/shared/src/`, the rulebook
 * kept naming them under `lib/` — including in the Timezone section, which the document itself
 * labels "a strict rule" and which showed `import { todayInTz } from '@/lib/date-utils'`. Zero
 * files import that path. A session following the most-emphasised rule verbatim wrote a broken
 * import, and at least two sessions had to grep for the real path (Q-153).
 *
 * A wrong path in a rulebook is worse than a wrong path in code: nothing compiles it, so it rots
 * silently and is copied confidently. This makes it fail like a broken build instead.
 *
 * Checks backticked paths and `@/…` / `@trainingai/…` import specifiers. Prose without backticks
 * is left alone — quoting a path is the signal that it is meant literally.
 */
const { readFileSync, existsSync } = require('fs')
const { join } = require('path')

const ROOT = process.cwd()
const DOC = 'CLAUDE.md'

/**
 * Paths CLAUDE.md names on purpose while saying they do NOT exist, or that are illustrative
 * rather than real. Each needs a reason — an unexplained entry here is how the check gets
 * hollowed out one exemption at a time.
 */
const DELIBERATE = new Map([
  ['lib/health/score-band.ts', 'named explicitly as NOT existing: "there is no lib/health/score-band.ts"'],
  ['app/api/ai/health-insight', 'a route directory referred to without its /route.ts'],
  ['app/api/training-load', 'same — and the text says its inline copy was retired'],
  ['docs/overview/history-*.md', 'a glob, not a path'],
  ['app/__x/page.tsx', 'an illustrative example of a path Next would 404'],
  ['android/app/build/outputs/apk/debug/app-debug.apk', 'a build artifact — absent until Gradle runs'],
])

/** Filename templates rather than paths: `<pillar>`, `YYYY-MM-DD`, and similar. */
const TEMPLATE = /[<>]|YYYY|MM-DD/

/** Extensions we can meaningfully resolve. A bare directory is checked as a directory. */
const RESOLVABLE = /\.(ts|tsx|js|jsx|sql|css|md|json|sh|yml|yaml)$/

function candidatePaths(text) {
  const out = new Map() // path -> first line number
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // Backticked spans, plus bare import specifiers inside fenced code.
    for (const m of line.matchAll(/`([^`]+)`/g)) addCandidate(out, m[1].trim(), i + 1)
    for (const m of line.matchAll(/from\s+['"]([^'"]+)['"]/g)) addCandidate(out, m[1].trim(), i + 1)
  })
  return out
}

function addCandidate(out, raw, line) {
  let p = raw
  // Import specifiers: `@/lib/x` is repo-root-relative; `@trainingai/shared/x` maps into the package.
  if (p.startsWith('@trainingai/shared/')) {
    p = 'packages/shared/src/' + p.slice('@trainingai/shared/'.length)
    if (!RESOLVABLE.test(p)) p += '.ts'
  } else if (p.startsWith('@/')) {
    p = p.slice(2)
    if (!RESOLVABLE.test(p) && !p.endsWith('/')) p += '.ts'
  }
  if (TEMPLATE.test(p)) return
  if (p.includes(' ') || p.includes('*') || p.includes('`')) {
    if (!DELIBERATE.has(raw)) return
  }
  // Only things that look like repo paths: a known top-level dir, or an extension we resolve.
  const top = p.split('/')[0]
  const KNOWN = ['app', 'components', 'lib', 'packages', 'scripts', 'docs', 'android', 'public', '.github']
  if (!KNOWN.includes(top)) return
  if (!RESOLVABLE.test(p) && !existsSync(join(ROOT, p)) && existsSync(join(ROOT, p + '.ts'))) p += '.ts'
  if (!out.has(p)) out.set(p, { line, raw })
}

const text = readFileSync(join(ROOT, DOC), 'utf8')
const candidates = candidatePaths(text)

const missing = []
for (const [p, { line, raw }] of candidates) {
  if (DELIBERATE.has(raw) || DELIBERATE.has(p)) continue
  if (existsSync(join(ROOT, p))) continue
  missing.push({ p, line, raw })
}

if (missing.length > 0) {
  console.error(`${DOC} names ${missing.length} path(s) that do not exist:`)
  for (const { p, line, raw } of missing) {
    const shared = 'packages/shared/src/' + p.replace(/^lib\//, '')
    const hint = p.startsWith('lib/') && existsSync(join(ROOT, shared))
      ? `  -> moved to ${shared}`
      : ''
    console.error(`  ${DOC}:${line}  \`${raw}\`${hint}`)
  }
  console.error('\nFix the path, or add it to DELIBERATE in scripts/check-claude-md-paths.js with a reason.')
  process.exit(1)
}

console.log(`check-claude-md-paths: OK (${candidates.size} paths in ${DOC} all exist)`)
