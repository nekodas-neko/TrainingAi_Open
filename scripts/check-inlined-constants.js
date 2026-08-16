#!/usr/bin/env node
/**
 * Catch vendor constants typed directly into publishable source.
 *
 * `check-private-paths.js` proves nothing *imports* the private material. It cannot see a number
 * someone copied out of a constants file and pasted into a `.ts`, because there is no import to
 * find — and that is exactly what `lib/health/daytime-stress.ts` did (2026-08-10): the dHRV feature
 * means and standard deviations, plus four 16-value saturation tables, sitting inline with a comment
 * saying "pinned from dhrv_imputation_1_1_0.constants.json".
 *
 * That one file undid the property the whole publish strategy rests on — that the ports are
 * publishable because the numbers they need are not in them. One inlined table and the port stops
 * being a shell. So this is not a tidiness check; it guards the actual claim.
 *
 * ## Why it does not drown in false positives
 *
 * The constants tree holds ~375,000 distinct numeric values, so `[0, 1, 2, 3, 4, 5]` matches it by
 * accident and so does a list of plate weights. Two filters make a hit mean something:
 *
 *   - **Every** element must appear in the vendor constants. One foreign value and it is our array.
 *   - The array must be *implausible as a coincidence*: at least three values carrying four or more
 *     decimal places, or twelve-plus values that are not an arithmetic sequence.
 *
 * Swept over the whole repository at introduction, those filters returned exactly the one real file
 * and nothing else.
 *
 * ## What it cannot do
 *
 * It compares against `lib/oura-models/constants/`. Once that tree leaves the repository this check
 * has nothing to compare against and must be repointed at the archived copy, or run before the move
 * and its result pinned. It also cannot see a single scalar threshold, only arrays — a lone magic
 * number is indistinguishable from ours.
 *
 * Run: `node scripts/check-inlined-constants.js`
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const CONSTANTS_DIR = path.join(ROOT, 'lib', 'oura-models', 'constants')
const SRC_ROOTS = ['app', 'components', 'lib', 'packages', 'hooks', 'android']
const SRC_EXT = ['.ts', '.tsx', '.kt']

/** Arrays that are known-inline and accepted, each with a reason. Empty is the goal. */
const ALLOW = new Map([])

function walk(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (['node_modules', '.next', 'build'].includes(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (SRC_EXT.some(x => e.name.endsWith(x))) out.push(full)
  }
  return out
}

const round = n => Number(n.toPrecision(7))

function collectNumbers(value, sink) {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) sink.add(round(value))
    return
  }
  if (Array.isArray(value)) return value.forEach(v => collectNumbers(v, sink))
  if (value && typeof value === 'object') Object.values(value).forEach(v => collectNumbers(v, sink))
}

const decimals = n => {
  const s = String(n)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

const isArithmetic = a => {
  if (a.length < 3) return false
  const step = a[1] - a[0]
  return a.every((v, i) => i === 0 || Math.abs(v - a[i - 1] - step) < 1e-9)
}

const ARRAY_RE = /\[\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?\s*,\s*){3,}-?\d+(?:\.\d+)?(?:e-?\d+)?\s*,?\s*\]/g

function main() {
  if (!fs.existsSync(CONSTANTS_DIR)) {
    // See the header: with the tree gone there is nothing to compare against. Say so rather than
    // passing silently, which would read as "no inlined constants found".
    console.log('check-inlined-constants: SKIPPED — lib/oura-models/constants/ is not present.')
    console.log('  Repoint this at the archived constants, or pin the last known-good result.')
    return
  }

  const vendor = new Set()
  for (const f of fs.readdirSync(CONSTANTS_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      collectNumbers(JSON.parse(fs.readFileSync(path.join(CONSTANTS_DIR, f), 'utf8')), vendor)
    } catch {
      /* a constants file we cannot parse contributes nothing; the dormancy sweep owns that */
    }
  }

  const findings = []
  for (const file of SRC_ROOTS.flatMap(r => walk(path.join(ROOT, r)))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    if (rel.startsWith('lib/oura-models/constants/')) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(ARRAY_RE)) {
      const nums = m[0]
        .slice(1, -1)
        .split(',')
        .map(s => parseFloat(s.trim()))
        .filter(Number.isFinite)
      if (nums.length < 6 || !nums.every(n => vendor.has(round(n)))) continue
      const precise = nums.filter(n => decimals(n) >= 4).length
      if (precise < 3 && !(nums.length >= 12 && !isArithmetic(nums))) continue
      const line = text.slice(0, m.index).split('\n').length
      if (ALLOW.has(`${rel}:${line}`)) continue
      findings.push({ rel, line, len: nums.length, sample: m[0].slice(0, 68) })
    }
  }

  if (findings.length) {
    console.error('FAIL — numeric arrays in publishable source that come from the vendor constants.')
    console.error('Import them from lib/oura-models/constants instead, so they move with the rest:')
    for (const f of findings) console.error(`  ${f.rel}:${f.line}  (${f.len} values)  ${f.sample}…`)
    process.exit(1)
  }

  console.log(`check-inlined-constants: OK (${vendor.size} vendor values, no inlined copies)`)
}

main()
