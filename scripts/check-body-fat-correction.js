#!/usr/bin/env node
// BF-2. `body_metrics.body_fat_pct` holds a BIA estimate that reads ~3.2 points low against the
// owner's DEXA, and it is the input to the Cunningham BMR, the calorie goal, the protein dose and
// `personalRmr`'s current fat-free mass. Every one of those has to see the CORRECTED value.
//
// The correction cannot live inside `listBodyMetrics`, which would make a missed site impossible:
// the health screen seeds its body-fat log field from that read and POSTs the value back at source
// `manual`, which outranks `scale_ble` — so a corrected value round-tripped through the edit sheet
// would overwrite the raw reading permanently and collapse the next calibration toward zero. The
// archive has to stay raw, so the correction is applied per consumer, and this check is what makes
// a forgotten consumer fail CI instead of shipping a quietly wrong calorie budget.
//
// Two rules, because there are two ways to consume a stored reading:
//   1. DERIVE from it — `bodyComposition`/`bodyCompSnapshot`/`cunninghamBmr`.
//   2. PASS IT ON — read `bodyFatPct` off a `listBodyMetrics` result and hand it somewhere else.
// Rule 2 exists because the calorie goal is reached that way: `recommend/route.ts` never calls a
// deriver itself, it feeds `calculateBaseline`. Rule 1 alone would have missed it.
//
// Either way the file must import the calibration, or be listed with the reason it does not.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DERIVERS = /\b(bodyComposition|bodyCompSnapshot|cunninghamBmr)\s*\(/
const READS_LIST = /\blistBodyMetrics\s*\(/
const READS_FIELD = /\bbodyFatPct\b/
// A file "handles the correction" either by computing it (`body-fat-calibration`) or by consuming a
// value some route already corrected (`body-fat-display`, LA-45). The second is how every SCREEN
// does it: correcting client-side would need the calibration on the device, and the raw reading has
// to stay reachable anyway so the log sheet can seed from it.
const CALIBRATION_IMPORT = /body-fat-(calibration|display)/

// Each entry states why the file derives body composition without correcting — never "it is fine".
const EXEMPT = {
  'packages/shared/src/health/body-composition.ts':
    'defines the derivation; correcting inside it would correct its own callers twice',
  'packages/shared/src/nutrition/goal-recommendation.ts':
    'derives from `input.bodyFatPct`, a value its caller supplies — the correction is applied at ' +
    'app/api/nutrition-goals/recommend/route.ts before the input is built',
}

// Rule 2 only. These read a stored body fat and pass it on for DISPLAY OR EDITING, where the raw
// number is the correct one to show — and in the first case, the one that must be shown.
const PASSTHROUGH_EXEMPT = {
  // NOTE: `body-metadata` and `day-log` were listed here until step 4. They now carry the
  // correction in `bodyFatCorrected`/`bodyFatIsCorrected` while `bodyFat` stays raw — an invariant
  // a file-level check cannot express, so it is pinned by
  // `lib/data/postgres/__tests__/body-fat-correction-consumers.test.ts` instead.
  'packages/shared/src/health/score-audit/build-day-audit.ts':
    'a score AUDIT — it reports what was actually stored on the day. A corrected number here ' +
    'would make the audit disagree with the row it is auditing, which defeats the point of it',
  'app/api/progress-summary/route.ts':
    'reads `getBodyMetricsBaseline`, which is the FIRST reading ever recorded — it predates ' +
    '`source_map`, so it carries no provenance and no calibration can apply to it',
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const failures = []
const handlesButListed = []
const exemptSeen = new Set()

for (const dir of ['app', 'lib', 'packages/shared/src']) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const src = fs.readFileSync(file, 'utf8')
    const derives = DERIVERS.test(src)
    const passesThrough = READS_LIST.test(src) && READS_FIELD.test(src)
    if (!derives && !passesThrough) continue
    // The import is checked BEFORE the exemption on purpose. A file that has since started handling
    // the calibration is no longer exempt, and leaving it listed hides that from the next reader —
    // the same failure as a stale entry pointing at a file that stopped consuming anything.
    if (CALIBRATION_IMPORT.test(src)) {
      const listed = rel in EXEMPT || rel in PASSTHROUGH_EXEMPT
      if (listed) handlesButListed.push(rel)
      continue
    }
    if (derives && rel in EXEMPT) { exemptSeen.add(rel); continue }
    if (!derives && rel in PASSTHROUGH_EXEMPT) { exemptSeen.add(rel); continue }
    failures.push(rel)
  }
}

// A stale exemption is its own bug: it reads as a considered decision about a file that has since
// stopped deriving anything, and the next reader trusts it.
const stale = [...Object.keys(EXEMPT), ...Object.keys(PASSTHROUGH_EXEMPT)].filter(rel => !exemptSeen.has(rel))

if (failures.length || stale.length || handlesButListed.length) {
  console.error('check-body-fat-correction FAILED\n')
  for (const rel of failures) {
    console.error(`  • ${rel} consumes a stored body fat without correcting it.`)
    console.error('      Apply `correctBodyFatPct(row.bodyFatPct, row.bodyFatSource, calibration)`')
    console.error('      with `repo.getBodyFatCalibration(userId)`, or add the file to EXEMPT in')
    console.error('      scripts/check-body-fat-correction.js with the reason it does not need it.\n')
  }
  for (const rel of handlesButListed) {
    console.error(`  • ${rel} imports the calibration but is still listed as exempt — remove the entry.\n`)
  }
  for (const rel of stale) {
    console.error(`  • ${rel} is listed as EXEMPT but no longer consumes a stored body fat — remove it.\n`)
  }
  process.exit(1)
}

console.log(`check-body-fat-correction: OK — every consumer of a stored body fat corrects or is exempt (${exemptSeen.size} exempt).`)
