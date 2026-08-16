#!/usr/bin/env node
/**
 * Build the synthetic model constants the test suite runs against (Q-49 A4b).
 *
 *   node scripts/generate-test-constants.js          # regenerate the fixtures
 *   node scripts/generate-test-constants.js --check  # fail if they are stale
 *
 * WHY THESE EXIST. The real constants are Oura's, and the public repo may not carry them. But ~24
 * test files evaluate a port that reads one, and they fail at *module scope* when the loader throws
 * — not because their assertions depend on vendor numbers. Deleting the real files without a
 * substitute would take the whole Oura pipeline out of CI.
 *
 * The alternative was a bucket credential in Actions secrets. That was rejected on a principle worth
 * stating once: **a public repo's test suite must not require secrets.** Fork PRs are not given
 * them, so the suite would be red for any outside contributor forever, and a live key would sit on a
 * repo anyone can read. This keeps CI credential-free and offline.
 *
 * WHAT IS AND IS NOT COPIED. Every key and every non-hash string is preserved; every **number** is
 * replaced. That split is what makes publishing these safe, and it is not arbitrary: our own ports
 * must name the keys they read (`attributes['decoder_base_settings']`, the feature-name lists), so
 * those names are already in the published source and copying them discloses nothing new. The
 * numbers are the vendor's actual tuning, and none of them survive.
 *
 * SHA-256 strings are the exception to "strings pass through", and they are worth calling out
 * because the first version of this script leaked them: `MANIFEST.json` and every file's
 * `source.sha256` carry hashes of Oura's original `.pt` binaries. That is not the IP itself, but it
 * is a fingerprint of it — enough to confirm a suspected file is the one we hold. They are mapped to
 * placeholders through a table shared across the whole run, so two originally-equal hashes stay
 * equal and `verifyConstantsIntegrity()` still has something to verify.
 *
 * ONLY WHAT THE LOADER CAN READ. Copying all 34 costs 6.5 MB of meaningless JSON, most of it models
 * no port touches. The set is derived from the filename literals in `constants/index.ts`, which is
 * exactly what the loader is able to open.
 *
 * TESTS ALWAYS USE THESE — never the real files, even on a machine that has them. Reading real
 * constants locally and synthetic ones in CI would let a test pass on one and fail on the other for
 * reasons unrelated to the change, which is the divergence this is meant to remove.
 *
 * WHAT THIS COSTS, stated plainly: the suite verifies the **pipeline**, not the **numbers**. A wrong
 * threshold inside a real constant is not caught here. It is not caught today either — nothing
 * asserts a vendor value — so this gives up nothing that currently exists, but do not read a green
 * suite as evidence that a constant is correct.
 */
const fs = require('node:fs')
const path = require('node:path')

const REAL_DIR = path.join(__dirname, '..', 'lib', 'oura-models', 'constants')
const OUT_DIR = path.join(__dirname, '..', 'lib', 'oura-models', '__fixtures__', 'constants')
const checkOnly = process.argv.includes('--check')

/**
 * Every constants file the loader can read, taken from the loader itself.
 *
 * `constants/index.ts` names all of them as string literals — the `MODEL_FILES` map's values plus
 * the four read directly (`MANIFEST.json`, the energy feature spec, the daytime-stress tables) — so
 * reading them out of that file is exact rather than approximate.
 *
 * **Hand-listing them was tried first and was wrong within the hour.** Tracing imports found seven
 * consumers and six files; the suite then failed on `cumulative_stress_1_2_2`, which a port reads at
 * module scope through a getter the grep pattern did not match. A list derived from the one file
 * that decides what is readable cannot have that gap, and a model added to `MODEL_FILES` later gets
 * a fixture without anyone remembering this script exists.
 *
 * Still far smaller than copying the tree: the bulk of the 12 MB is in models no port reads.
 */
function fixtureFiles() {
  const src = fs.readFileSync(path.join(REAL_DIR, 'index.ts'), 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/'([\w.-]+\.json)'/g)) names.add(m[1])
  if (names.size === 0) throw new Error('no .json literals found in constants/index.ts — has it moved?')
  return [...names].sort()
}

/**
 * Integer keys that are **shape, not tuning** — preserved exactly, because a port allocates from
 * them and a randomised size writes past the end of a matrix (`Cannot set properties of undefined`,
 * which is how this list came to exist rather than by inspection).
 *
 * Preserving them discloses nothing: `steps-motion-decoder.ts` sizes `outData` as
 * `n_features_30s × n_output_features` in published source, and carries `data_columns.length // 27`
 * in a comment. The published port already states these dimensions; the fixture repeating them adds
 * no information.
 *
 * Keep this list minimal and justify each addition. A value that influences an *output* rather than
 * an allocation is tuning, and belongs scrubbed however structural its name looks.
 */
const STRUCTURAL_KEYS = new Set(['n_features_30s', 'n_output_features'])

/** Original hash → placeholder, shared across every file so equal hashes stay equal. */
const hashes = new Map()
const SHA256 = /^[a-f0-9]{64}$/i

function fakeHash(real) {
  let placeholder = hashes.get(real)
  if (!placeholder) {
    placeholder = String(hashes.size + 1).padStart(2, '0').repeat(32).slice(0, 64)
    hashes.set(real, placeholder)
  }
  return placeholder
}

/**
 * Replace one number, deterministically from its position in the walk.
 *
 * A ramp rather than a constant: several vendored tables are lookup curves the ports interpolate
 * across or bisect into, and a table of identical values makes those degenerate (a bisect returns
 * the same index for every input, so a test that distinguishes two inputs cannot). Ramping keeps
 * them monotonic and distinguishable without carrying any real magnitude.
 *
 * Integers stay integers. A port that indexes an array with a constant, or compares against a count,
 * breaks on a fractional value in a way that has nothing to do with what is being tested.
 */
function fakeNumber(n, seq) {
  if (!Number.isFinite(n)) return n
  if (Number.isInteger(n)) return (seq % 8) + 1
  return Number((((seq % 10) + 1) / 10).toFixed(3))
}

function scrub(value, state, key) {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && STRUCTURAL_KEYS.has(key)) return value
    return fakeNumber(value, state.seq++)
  }
  if (Array.isArray(value)) return value.map(v => scrub(v, state, key))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, state, k)
    return out
  }
  if (typeof value === 'string' && SHA256.test(value)) return fakeHash(value)
  // Other strings, booleans and null pass through — see the header on why names are safe to keep.
  return value
}

function build() {
  if (!fs.existsSync(REAL_DIR)) return null
  const out = new Map()
  for (const file of fixtureFiles()) {
    const src = path.join(REAL_DIR, file)
    if (!fs.existsSync(src)) throw new Error(`constants/index.ts names ${file}, which is not in the real set`)
    const real = JSON.parse(fs.readFileSync(src, 'utf8'))
    // Per-file seed reset, so one file's content cannot shift another file's values. Without it,
    // adding a constant to an early file rewrites every later file and the diff is unreadable.
    out.set(file, JSON.stringify(scrub(real, { seq: 0 }, null), null, 2) + '\n')
  }
  return out
}

function main() {
  const built = build()
  if (!built) {
    console.error(`The real constants are not present at ${path.relative(process.cwd(), REAL_DIR)}.`)
    console.error('Fixtures can only be regenerated on a machine that has them; the committed copies')
    console.error('are what CI uses, and they do not need regenerating unless a constant changed shape.')
    process.exit(checkOnly ? 0 : 1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const stale = []
  for (const [file, content] of built) {
    const dest = path.join(OUT_DIR, file)
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null
    if (current === content) continue
    stale.push(file)
    if (!checkOnly) fs.writeFileSync(dest, content)
  }

  // A fixture whose real counterpart is gone is worse than a missing one: the loader would serve it
  // forever and no test would notice the constant had been retired.
  const orphans = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.json') && !built.has(f))
  for (const f of orphans) {
    stale.push(`${f} (no longer named by constants/index.ts)`)
    if (!checkOnly) fs.unlinkSync(path.join(OUT_DIR, f))
  }

  if (checkOnly) {
    if (stale.length) {
      console.error(`${stale.length} fixture(s) out of date:\n  ${stale.join('\n  ')}`)
      console.error('\nRun: node scripts/generate-test-constants.js')
      process.exit(1)
    }
    console.log(`All ${built.size} constants fixtures match the real set's structure.`)
    return
  }

  console.log(`${built.size} fixtures written to ${path.relative(process.cwd(), OUT_DIR)}`)
  console.log(stale.length ? `  ${stale.length} changed` : '  nothing changed')
}

main()
