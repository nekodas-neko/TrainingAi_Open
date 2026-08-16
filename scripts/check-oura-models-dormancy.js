#!/usr/bin/env node
/**
 * Dormancy sweep for `lib/oura-models/` — fails when a vendored model module or asset is tracked but
 * unreachable from the app.
 *
 * This tree holds Oura's extracted proprietary models. Every file in it is a liability twice over:
 * it is the payload the public-repo migration has to move out (Q-49), and it is vendored IP we would
 * rather not carry at all. Dead files here are worse than dead files elsewhere, and they accumulate
 * quietly, because nothing breaks when unused vendored code just sits there.
 *
 * Reachability, not just "is it imported somewhere": a module imported only by another dead module
 * is still dead. Roots are the files imported from OUTSIDE `lib/oura-models/`; everything reachable
 * from a root is live; the rest is dormant. Assets (`.onnx`, `.constants.json`) are live when a live
 * module mentions their basename.
 *
 * KNOWN LIMIT — this is FILE-level reachability, not function-level. `inference/dhrv` is the worked
 * example: `lib/health/daytime-stress.ts` imports it, so this script calls it live, but the only
 * function that calls it (`computeDaytimeStress`) is itself reached from tests alone — D5 replaced
 * that path in production with our own regression. So a module can pass this check and still be
 * production-dead. Do not read a green run as "nothing here is dead"; read it as "nothing here is
 * unreferenced". Closing that gap means call-graph analysis, which is a different tool.
 *
 * Run: `node scripts/check-oura-models-dormancy.js`
 */
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const TREE = 'lib/oura-models/'

/** Files that are deliberately unreferenced and must NOT be swept. Each needs a reason — an
 *  unexplained entry here is how a dormancy sweep quietly stops sweeping. */
const KEEP = new Map([
  ['lib/oura-models/inference/session-web.ts',
   'The onnxruntime-web sibling of session.ts, byte-parity-proven against the node goldens. Zero ' +
   'callers by design until D2 Task 6 wires the on-device rollup; deleting it would throw away ' +
   'the proven half of that work.'],

  // ── The vendored assets are gone (Q-49 A4b) ────────────────────────────────────────────────
  // This list used to carry 33 entries: 19 constants files indexed by MANIFEST.json but imported by
  // nothing, the two BDI `.onnx` no loader names, and all 14 extracted `.weights.npz` — 44 MB, the
  // single largest thing in the repository. Each was kept rather than swept because re-extracting
  // them was impossible from here, which made deleting them an owner decision rather than a sweep's.
  //
  // That decision was made: they are untracked and gitignored, and the eight models production
  // actually loads come from object storage instead. So the entries are not "resolved", they are
  // *unreachable* — `git ls-files` no longer returns any of these paths, and an exemption for a file
  // that cannot be listed exempts nothing. They are removed so this list keeps meaning what it says.
  //
  // If a vendored asset is ever committed again, it belongs in scripts/private-paths.json and in
  // .gitignore, not here.
])

const tracked = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean)

const treeFiles = tracked.filter(f => f.startsWith(TREE))
const modules = treeFiles.filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
// `.weights.npz` was missing from this list until 2026-08-04, which mattered more than the other
// two combined: the 15 weight files are **44 MB of a 101 MB repository** — the single largest thing
// in it — and the tool built to find dormant model assets was not looking at them at all.
const assets = treeFiles.filter(f =>
  f.endsWith('.onnx') || f.endsWith('.constants.json') || f.endsWith('.weights.npz'))

const sourceFiles = tracked.filter(f => /\.(ts|tsx|js|mjs)$/.test(f))
const textOf = new Map()
const read = f => {
  if (!textOf.has(f)) {
    try { textOf.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8')) } catch { textOf.set(f, '') }
  }
  return textOf.get(f)
}

/** Every module path an import specifier in `from` could resolve to inside the tree. */
function importsOf(from) {
  const out = new Set()
  const src = read(from)
  const dir = path.dirname(from)
  for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const spec = m[1]
    let base = null
    if (spec.startsWith('@/')) base = spec.slice(2)
    else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(dir, spec))
    if (!base || !base.startsWith(TREE)) continue
    for (const cand of [`${base}.ts`, `${base}/index.ts`, base]) {
      if (modules.includes(cand)) { out.add(cand); break }
    }
  }
  return out
}

// Roots: tree modules imported from outside the tree (app code, tests, scripts).
const roots = new Set()
for (const f of sourceFiles) {
  if (f.startsWith(TREE) && !f.includes('__tests__')) continue // in-tree, non-test — not a root
  for (const target of importsOf(f)) roots.add(target)
}

// Transitive closure.
const live = new Set(roots)
const queue = [...roots]
while (queue.length) {
  for (const target of importsOf(queue.pop())) {
    if (!live.has(target)) { live.add(target); queue.push(target) }
  }
}

const dormantModules = modules.filter(f => !live.has(f) && !KEEP.has(f))
// An asset is live when any live module mentions its basename.
const liveText = [...live].map(read).join('\n')
const dormantAssets = assets.filter(a => !KEEP.has(a) && !liveText.includes(path.basename(a)))

const dormant = [...dormantModules, ...dormantAssets].sort()
if (dormant.length === 0) {
  console.log(`check-oura-models-dormancy: OK (${modules.length} modules, ${assets.length} assets, ${live.size} reachable)`)
  process.exit(0)
}

console.error('check-oura-models-dormancy: FAIL — tracked but unreachable from the app:\n')
for (const f of dormant) console.error(`  ${f}`)
console.error(`\n${dormant.length} dormant file(s). Delete them, or add a KEEP entry in this script`)
console.error('with the reason the file must stay despite having no importer.')
process.exit(1)
