// Training Stress Score (OTS) core — a faithful TypeScript port of the algorithmic
// TorchScript model `training_stress_score_0_2_1` (0 trainable params: pure control flow).
// Pinned to the captured golden vector in __tests__/ots.test.ts (< 1e-3). Do NOT "improve"
// the algorithm or re-derive constants — the vendored constants.json (getOtsTypedConstants)
// is the source and the .pt-captured golden is the parity proof. Ported line-for-line from
// the vendor's `training_stress_score_0_2_1` model source (private archive)
import { getOtsTypedConstants } from '@/lib/oura-models/constants'

export interface OtsInput {
  startTimestampMs: number
  mets: Float32Array          // raw 1-min MET series (validated: no NaN when noOts=0, ≥720 long)
  age: number
  biologicalSex: -1 | 0 | 1   // female=-1, other=0, male=1
  rhr: number                 // 30..100
  noOts: 0 | 1
  tzChange: 0 | 1
  readiness: number           // 0..100 (hard-validated; NaN rejected)
  vo2max: number              // may be NaN → processor uses rhr_weights
}

// Read on FIRST USE, memoised — not at module scope. `next build` imports every route to
// collect page data, so a module-scope read opened the constants file at build time, and the
// directory only exists at runtime now that the vendored copies are gone (Q-49 A4b). Each
// function below takes its own `const C = C_()` so the bodies read exactly as before.
let cCache: ReturnType<typeof getOtsTypedConstants> | null = null
const C_ = (): ReturnType<typeof getOtsTypedConstants> => (cCache ??= getOtsTypedConstants())

// ── Validator (___torch_mangle_0) — returns error code 0 (valid) or 1-9 ─────────────
function validate(i: OtsInput): number {
  const C = C_()
  const binary = (v: number) => v === 0 || v === 1
  if (Number.isNaN(i.noOts) || !binary(i.noOts)) return 1
  // mets: 1-D; when noOts=0 need ≥min_mets_count and no NaN
  if (i.noOts === 0) {
    if (i.mets.length < C.minMetsCount) return 2
    for (let k = 0; k < i.mets.length; k++) if (Number.isNaN(i.mets[k])) return 2
  }
  if (Number.isNaN(i.startTimestampMs)) return 3
  if (Number.isNaN(i.age)) return 4
  if (Number.isNaN(i.biologicalSex) || ![-1, 0, 1].includes(i.biologicalSex)) return 5
  if (Number.isNaN(i.rhr) || i.rhr < 30 || i.rhr > 100) return 6
  if (Number.isNaN(i.tzChange) || !binary(i.tzChange)) return 7
  if (Number.isNaN(i.readiness) || i.readiness < 0 || i.readiness > 100) return 8
  if (!Number.isNaN(i.vo2max) && (i.vo2max < 10 || i.vo2max > 100)) return 9
  return 0
}

// ── vo2max_numeric_to_category (___torch_mangle_4) ──────────────────────────────────
function vo2maxNumericToCategory(vo2max: number, age: number, biologicalSex: number): number {
  const C = C_()
  if (Number.isNaN(vo2max)) return NaN
  const sex0 = biologicalSex === -1 ? 0 : 1
  const ageYears = Math.trunc(age)
  let found = false
  let lowFair = 0, fairHigh = 0, highPeak = 0
  for (let r = 0; r < 24 && !found; r++) {
    const row = C.vo2maxThresholds[r]
    const s = Math.trunc(row[0]), ageMin = Math.trunc(row[1]), ageMax = Math.trunc(row[2])
    if (s === sex0 && ageMin <= ageYears && ageYears <= ageMax) {
      found = true
      lowFair = row[3]; fairHigh = row[4]; highPeak = row[5]
    }
  }
  if (!found) return NaN
  if (vo2max < lowFair) return 0
  if (vo2max < fairHigh) return 1
  if (vo2max < highPeak) return 2
  return 3
}

// ── Preprocessor (___torch_mangle_1) ────────────────────────────────────────────────
function getAgeGroup(age: number, biologicalSex: number): number {
  const C = C_()
  if (biologicalSex === 0) {
    let a = age <= 20 ? 20 : age
    a = a >= 60 ? 60 : a
    const ageGroupVal = Math.floor(a / 10) * 10
    return C.otherAgeGroups.indexOf(ageGroupVal)
  }
  const a = age >= 80 ? 80 : age
  const ageGroupVal = Math.floor(a / 10) * 10
  return C.femaleAndMaleAgeGroups.indexOf(ageGroupVal)
}

function argminAbsDiff(row: number[], rhr: number): number {
  let best = 0, bestDiff = Infinity
  for (let j = 0; j < row.length; j++) {
    const d = Math.abs(row[j] - rhr)
    if (d < bestDiff) { bestDiff = d; best = j }
  }
  return best
}

function getRhrCategory(ageGroup: number, biologicalSex: number, rhr: number): number {
  const C = C_()
  const table = biologicalSex === -1 ? C.femalePercentiles
    : biologicalSex === 1 ? C.malePercentiles
      : C.otherPercentiles
  return argminAbsDiff(table[ageGroup], rhr)
}

// met < min_met_value → NaN (clean_met_values)
function cleanMets(mets: Float32Array): Float64Array {
  const C = C_()
  const out = new Float64Array(mets.length)
  for (let k = 0; k < mets.length; k++) out[k] = mets[k] < C.minMetValue ? NaN : mets[k]
  return out
}

// ── met_intensity_weight_norm (___torch_mangle_5) ───────────────────────────────────
function metIntensityWeightNorm(met: number): number {
  const C = C_()
  const clamped = Math.min(10, Math.max(1, met)) // NaN clamps to NaN (min/max propagate)
  const x = (clamped - 1) / 9
  return Math.pow(x, C.metIntensityGamma) * (C.metIntensityM - 1) + 1
}

/** Returns the day's OTS value + whether it exceeds the high threshold, or null when the
 *  model can't produce a result (validation failure, tz change, <360 valid MET minutes,
 *  no_ots short-circuit, all-NaN series). Infallible: never throws. */
export function runTrainingStressScore(input: OtsInput): { ots: number; high: boolean } | null {
  const C = C_()
  if (validate(input) !== 0) return null
  if (input.tzChange === 1) return null

  const vo2maxCategory = vo2maxNumericToCategory(input.vo2max, input.age, input.biologicalSex)

  // no_ots short-circuit: numel(mets) < min_mets_count → NaN result (→ null)
  if (input.noOts === 1 && input.mets.length < C.minMetsCount) return null

  const startSec = Math.floor(input.startTimestampMs / 1000)
  const n = input.mets.length
  if (n < 720) return null

  const metValues = cleanMets(input.mets)                 // <0.9 → NaN
  // met_timestamps_1min = arange(startSec, startSec + n*60, 60); ots timestamps are [719:]
  const numWindows = n - 720 + 1
  const totalWeight = C.metWeights.reduce((s, w) => s + w, 0)
  const useIntensity = C.useMetIntensityWeights

  // vo2max weighting: rhr-based when vo2max category (or weights) is NaN
  const vo2maxWeightsHaveNaN = C.vo2maxWeights.some(Number.isNaN)
  let categoryWeight: number
  if (Number.isNaN(vo2maxCategory) || vo2maxWeightsHaveNaN) {
    const rhrCategory = getRhrCategory(getAgeGroup(input.age, input.biologicalSex), input.biologicalSex, input.rhr)
    categoryWeight = C.rhrWeights[rhrCategory]
  } else {
    categoryWeight = C.vo2maxWeights[vo2maxCategory]
  }

  const threshold = input.readiness < 60 ? C.highOtsThreshold * 0.9 : C.highOtsThreshold

  // Sliding 720-window, stride 1. Track only the LAST non-NaN OTS (the day's end-of-day
  // rolling load) — the model returns the whole masked series and callers read the last value.
  let lastOts = NaN
  for (let w = 0; w < numWindows; w++) {
    // window timestamp (the 720th minute of this window) — mask is ts > startSec, always true
    // here (ts = startSec + (w+719)*60 > startSec), ported faithfully as a guard.
    const windowEndTs = startSec + (w + 719) * 60
    if (!(windowEndTs > startSec)) continue

    let weightedSum = 0
    let validCount = 0
    for (let j = 0; j < 720; j++) {
      const met = metValues[w + j]
      if (!Number.isNaN(met)) validCount++
      const factor = useIntensity ? met * metIntensityWeightNorm(met) : met
      const weighted = factor * C.metWeights[j]
      if (!Number.isNaN(weighted)) weightedSum += weighted   // nansum: NaN → 0
    }
    let ots = weightedSum / totalWeight
    if (validCount < 360) ots = NaN
    ots = ots * categoryWeight
    if (!Number.isNaN(ots)) ots = Math.max(ots, 0.9)         // clamp ≥0.9, preserve NaN
    if (!Number.isNaN(ots)) lastOts = ots
  }

  if (Number.isNaN(lastOts)) return null
  return { ots: lastOts, high: lastOts > threshold }
}
