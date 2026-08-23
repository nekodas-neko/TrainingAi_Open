#!/usr/bin/env node
/**
 * Build and test the tree as it would exist in the public repo.
 *
 * The public cut is a fresh `git init` over a copy of this working tree with the private paths
 * removed. The failure mode that copy has — and the reason this script exists — is an excluded file
 * that something still reads. That is invisible here, where the file is present, and obvious there,
 * where the repo is already public and already broken. So: make the copy, delete the paths, and run
 * the gate against it.
 *
 * The copy comes from `git archive HEAD`, not a filesystem copy, because tracked files are exactly
 * what a fresh commit would carry — no build output, no `.env.local`, no untracked scratch.
 * `node_modules` is symlinked rather than installed: the point is to catch a missing *source* file,
 * and a `pnpm install` would add several minutes and a network dependency to every run.
 *
 * ## Two modes, because the answer differs
 *
 *   --ready  (default)  Remove only the paths the manifest declares `importedByCode: false`.
 *                       This is what could be published today. It should be green.
 *   --all               Remove every private path, including the ones still imported.
 *                       This is the end state. It is expected to fail until the remaining
 *                       entanglement is resolved, and the failures ARE the worklist.
 *
 * Run: `node scripts/publish-dry-run.js [--ready|--all] [--keep]`
 */
const { execFileSync, execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = process.cwd()
const MODE = process.argv.includes('--all') ? 'all' : 'ready'
const KEEP = process.argv.includes('--keep')

/**
 * The constants are a RUNTIME dependency, not a build-time one — that is the whole point of the
 * loader that replaced their static imports. Removing them from git therefore does not mean the app
 * runs without them; it means they arrive from somewhere else. Pointing `OURA_CONSTANTS_DIR` at the
 * real directory models exactly that delivery, which is what production now does from the bucket.
 *
 * Set only when this machine actually has them. Since A4b deleted them, the usual case is that it
 * does not, and an env var pointing at a directory that is not there is worse than no env var at
 * all: it would override `vitest.config.ts`'s own fallback to the synthetic fixtures and turn every
 * constants-reading test into a loader throw, which is a failure of this script rather than a
 * finding about the tree.
 *
 * So be precise about what a green `--all` proves: **nothing in the published tree needs these files
 * at build time.** It does not prove production works without them — production still needs them,
 * from the bucket. Conflating the two would be the comfortable misreading.
 */
const REAL_CONSTANTS = path.join(ROOT, 'lib', 'oura-models', 'constants')
const RUNTIME_ENV = fs.existsSync(path.join(REAL_CONSTANTS, 'MANIFEST.json'))
  ? { OURA_CONSTANTS_DIR: REAL_CONSTANTS }
  : {}

function run(cmd, args, cwd, label) {
  process.stdout.write(`  ${label.padEnd(28)}`)
  try {
    execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...RUNTIME_ENV } })
    console.log('ok')
    return { ok: true, output: '' }
  } catch (err) {
    console.log('FAILED')
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'private-paths.json'), 'utf8'))
  const toRemove = manifest.paths.filter(p => MODE === 'all' || p.importedByCode === false)

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-dry-run-'))
  const tree = path.join(work, 'tree')
  fs.mkdirSync(tree)

  console.log(`Publish dry-run — mode: ${MODE}`)
  console.log(`  workspace: ${work}\n`)

  // Tracked files only: that is what a fresh `git init` + commit would carry.
  execSync(`git archive HEAD | tar -x -C "${tree}"`, { cwd: ROOT, stdio: 'pipe' })

  let removedBytes = 0
  for (const entry of toRemove) {
    const target = path.join(tree, entry.path)
    if (!fs.existsSync(target)) continue
    // Excluded subpaths stay — `onnx/__fixtures__` holds our own golden vectors and recordings.
    const keep = (entry.excludes ?? []).map(x => path.join(tree, x)).filter(p => fs.existsSync(p))
    const stash = keep.map(k => {
      const tmp = path.join(work, 'keep', path.relative(tree, k))
      fs.mkdirSync(path.dirname(tmp), { recursive: true })
      fs.renameSync(k, tmp)
      return [tmp, k]
    })
    removedBytes += dirSize(target)
    fs.rmSync(target, { recursive: true, force: true })
    for (const [tmp, orig] of stash) {
      fs.mkdirSync(path.dirname(orig), { recursive: true })
      fs.renameSync(tmp, orig)
    }
    console.log(`  removed ${entry.path}`)
  }
  console.log(`\n  ${(removedBytes / 1048576).toFixed(1)} MB removed, ${toRemove.length} paths\n`)

  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tree, 'node_modules'), 'dir')

  // A fresh `git init` + one commit — which is literally what the cut is, and what several checks
  // need: `check-oura-models-dormancy` asks `git ls-files` what is tracked, and would otherwise
  // report the removal as a crash rather than an answer.
  execSync('git init -q && git add -A && git -c user.email=dry@run -c user.name=dry commit -qm snapshot', {
    cwd: tree, stdio: 'pipe',
  })

  const GATES = [
    ['typecheck', 'npx', ['tsc', '--noEmit']],
    ['tests', 'npx', ['vitest', 'run']],
    ['private-paths', 'node', ['scripts/check-private-paths.js']],
    ['dormancy', 'node', ['scripts/check-oura-models-dormancy.js']],
    ['inlined-constants', 'node', ['scripts/check-inlined-constants.js']],
    // Removing a doc breaks every link to it. In the working tree those links resolve, so this is
    // only ever visible here — which makes it exactly the class of thing the dry-run exists for.
    ['doc-links', 'node', ['scripts/check-doc-links.js']],
    // `next build` — the gate whose absence let A4b's real blocker through (Q-313).
    //
    // A3 was recorded as having made the model constants a runtime-only dependency, and a green
    // `--all` from this script was the evidence. It was wrong: six modules still read a constant at
    // **module scope**, and `next build` imports every route to collect page data, so the build
    // opened the files. Deleting them produced `ENOENT … energy-expenditure-features.json` at
    // *Failed to collect page data for /api/achievements* — a failed Railway deploy, not a local
    // annoyance. `tsc --noEmit` cannot see it, because the fault is a file read at import time and
    // not a type.
    //
    // `--all` only, and the cost is the reason: a build is minutes where every other gate is
    // seconds. `--all` is the mode that models the end state and is run rarely, which is exactly
    // where a slow gate belongs. The baseline re-run below still tells a pre-existing red from a
    // regression, so a slow gate stays trustworthy rather than becoming one people learn to ignore.
    ...(MODE === 'all' ? [['build', 'npx', ['next', 'build']]] : []),
  ]

  const results = GATES.map(([name, cmd, args]) => [name, run(cmd, args, tree, name)])

  // A gate that also fails on the UNMODIFIED tree is not telling us anything about the removal —
  // a missing optional dependency, a flaky environment, a pre-existing red. Only a gate that the
  // full tree passes and the stripped tree fails is evidence that something we deleted was needed.
  // Without this the script reports the environment, and a gate that is always red gets ignored.
  const broken = []
  const preExisting = []
  const stillFailing = results.filter(([, r]) => !r.ok)
  if (stillFailing.length) {
    console.log('\n  re-running failed gates against the unmodified tree to tell regression from noise')
    const pristine = path.join(work, 'pristine')
    fs.mkdirSync(pristine)
    execSync(`git archive HEAD | tar -x -C "${pristine}"`, { cwd: ROOT, stdio: 'pipe' })
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(pristine, 'node_modules'), 'dir')
    execSync('git init -q && git add -A && git -c user.email=dry@run -c user.name=dry commit -qm base', {
      cwd: pristine, stdio: 'pipe',
    })
    for (const [name, r] of stillFailing) {
      const [, cmd, args] = GATES.find(g => g[0] === name)
      const base = run(cmd, args, pristine, `${name} (baseline)`)
      ;(base.ok ? broken : preExisting).push([name, r])
    }
  }

  console.log('')
  for (const [name, r] of broken) {
    console.log(`─── ${name} — BROKEN BY THE REMOVAL ───`)
    console.log(r.output.split('\n').slice(-40).join('\n'))
  }
  for (const [name] of preExisting) {
    console.log(`─── ${name} — fails on the unmodified tree too; not caused by the removal ───`)
  }
  const failed = broken

  if (!KEEP) fs.rmSync(work, { recursive: true, force: true })
  else console.log(`\n  workspace kept at ${work}`)

  if (failed.length) {
    console.error(
      `\nFAIL (${MODE}) — ${failed.length} of ${results.length} gates failed on the published tree.` +
        (MODE === 'all'
          ? '\nIn --all mode this is the expected state until the remaining imports are resolved;\nthe output above is the worklist, not a regression.'
          : '\nIn --ready mode this IS a regression: something now depends on a path we planned to drop.'),
    )
    process.exit(MODE === 'ready' ? 1 : 2)
  }
  const caveat = preExisting.length
    ? ` (${preExisting.map(([n]) => n).join(', ')} red on the unmodified tree too — unrelated)`
    : ''
  console.log(`\nOK — nothing the ${MODE} tree removes was needed${caveat}.`)
}

/** Entries may be a directory or a single file — the manifest carries both. */
function dirSize(target) {
  if (!fs.statSync(target).isDirectory()) return fs.statSync(target).size
  let total = 0
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, e.name)
    total += e.isDirectory() ? dirSize(full) : fs.statSync(full).size
  }
  return total
}

main()
