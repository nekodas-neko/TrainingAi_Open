#!/usr/bin/env node
/**
 * Every repo path the orientation indexes name must exist.
 *
 * `scripts/check-claude-md-paths.js` already does this for CLAUDE.md, for the reason recorded in its
 * header: a wrong path in a rulebook rots silently and is copied confidently, because nothing
 * compiles it. The same argument applies verbatim to the other documents sessions are told to read
 * before starting work — `docs/module-map.md` and the eleven `docs/domains/<pillar>/README.md` indexes —
 * and nothing checked those.
 *
 * Found on the sweep that added this (Q-554): `docs/module-map.md` carried a row for
 * `lib/oura-ble/steps-motion-decoder.ts` → `decodeStepsPacket(cols27)`. Neither the file nor the
 * function exists anywhere in the tree. The module map's stated purpose is "what already exists and
 * where", read specifically to stop new work re-implementing infrastructure the app already has — so
 * a row for something unbuilt is the one failure that map cannot afford. `docs/domains/workouts`
 * likewise listed a UI route `app/history/` that does not exist.
 *
 * Deliberately narrow, because these documents are prose-heavy and a noisy check gets disabled:
 *  - only backticked paths anchored at a known top-level directory are considered;
 *  - globs, ellipses and filename templates are skipped — they are patterns, not paths;
 *  - a path the document names while saying it is gone needs a DELIBERATE entry with a reason.
 */
const { readFileSync, existsSync } = require('fs')
const { join } = require('path')

const ROOT = process.cwd()

const DOCS = [
  'docs/module-map.md',
  ...['sleep', 'readiness', 'heart-rate', 'cardio', 'activity', 'workouts', 'nutrition', 'body',
      'devices', 'app-shell', 'platform'].map((d) => `docs/domains/${d}/README.md`),
]

/** Paths named on purpose while saying they do NOT exist. Each needs a reason. */
const DELIBERATE = new Map([
  ['lib/oura/sync-throttle.ts',
   'module-map says outright "is deleted" — removed with the Oura Cloud integration (Q-224)'],
  ['lib/oura-ble/steps-motion-decoder.ts',
   'module-map now names it as NOT BUILT (Q-554); the real port is lib/oura-models/steps-motion-decoder.ts'],
  ['app/history/',
   'workouts index names it as removed; history renders in components/exercise-history-sheet.tsx (Q-554)'],
  ['docs/oura-models/',
   'devices index names it as non-existent; the ops reference is docs/oura-ble-operations.md (Q-554)'],
  ['app/overview/',
   'app-shell index names it as a route that does not exist (Q-554)'],
  ['components/health/day-overlay-sheet.tsx',
   'app-shell index names it as deleted; its two live affordances moved to /health/day (LB-3)'],
  ['lib/push.ts',
   'module-map names it as deleted with the whole web-push stack — no senders, no subscribers (Q-285)'],
  ['lib/push-client.ts',
   'module-map names it as deleted with the whole web-push stack — no senders, no subscribers (Q-285)'],
])

const TOP = /^(app|lib|components|packages|scripts|docs|android|e2e|public)\//
const PATTERN = /[<>*…]|\.\.\.|\bNNN\b|YYYY|MM-DD|\*\*/

function candidates(text) {
  const out = new Map()
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      let p = m[1].trim()
      if (p.startsWith('@/')) p = p.slice(2)
      if (p.startsWith('@trainingai/shared/')) p = 'packages/shared/src/' + p.slice(19)
      if (!TOP.test(p)) continue          // relative fragments are resolved against prose context
      if (PATTERN.test(p)) continue       // a glob is not a path
      if (/\s/.test(p) || p.includes('|')) continue
      p = p.replace(/[),.]+$/, '')
      if (!out.has(p)) out.set(p, i + 1)
    }
  })
  return out
}

/**
 * **No `packages/shared/src/` fallback, deliberately (LA-35).** It used to end this list, so a doc
 * naming `lib/health/vo2max.ts` resolved against `packages/shared/src/health/vo2max.ts` and passed.
 * That is not a lenient edge case: it is the ONE error class this map exists to prevent — CLAUDE.md
 * sends readers here precisely because the monorepo extraction moved that code and the docs kept
 * saying `lib/` (Q-153). **92 paths across 8 orientation docs were wrong that way and all reported
 * OK.** With the fallback gone the check says what it claims to say.
 */
const resolves = (p) =>
  [p, `${p}.ts`, `${p}.tsx`, `${p}/route.ts`, `${p}/index.ts`].some((v) => existsSync(join(ROOT, v)))

let checked = 0
const missing = []
for (const doc of DOCS) {
  for (const [p, line] of candidates(readFileSync(join(ROOT, doc), 'utf8'))) {
    if (DELIBERATE.has(p)) continue
    checked++
    if (!resolves(p)) missing.push({ doc, p, line })
  }
}

if (missing.length > 0) {
  console.error('Orientation index(es) name repo paths that do not exist:\n')
  for (const m of missing) {
    // The hint, not the resolution — the shape `check-claude-md-paths.js` already uses. Saying
    // "moved to X" makes the failure actionable; ACCEPTING X is what let 108 wrong paths pass.
    const shared = 'packages/shared/src/' + m.p.replace(/^lib\//, '')
    const hint = m.p.startsWith('lib/') && existsSync(join(ROOT, shared)) ? `  -> moved to ${shared}` : ''
    console.error(`  • ${m.doc}:${m.line}  ${m.p}${hint}`)
  }
  console.error(
    '\nThese documents are read as "what exists and where" before work starts, so a wrong path sends' +
      '\nthe next session looking in the wrong place — or re-implementing what it concludes is absent.' +
      '\nFix the path, or add a DELIBERATE entry with a reason if the document names it as gone.',
  )
  process.exit(1)
}
console.log(`check-index-doc-paths: OK — ${checked} paths across ${DOCS.length} orientation docs all exist.`)
