// cumulative_stress_1_2_2 (ChronicStress) — a faithful TypeScript port of the 0-parameter
// algorithmic TorchScript model. Given ~2 weeks of nightly biometrics (fragmentation, HR,
// HRV, activity, skin-temperature series + the latest night's raw signals) it produces a
// chronic-stress score (0–100), five signed UI contributors, and the raw intermediates the
// stress rollup persists. It is the §4 pair to stress-resilience.
//
// Pinned to the captured .pt golden vector
// (lib/oura-models/onnx/__fixtures__/cumulative_stress_1_2_2.golden.json, all 19 outputs < 1e-3).
// Ported verbatim from the vendor's `cumulative_stress_1_2_2` model source (private archive):
// preprocessor, processor, top-level forward and its utility helpers. Do NOT re-derive the
// constants or "improve" the algorithm — the golden is the source of truth.
//
// Validation is reduced to a pragmatic gate (the .pt's 568-line Validator is error-code
// boilerplate): the run returns all-NaN outputs when it cannot produce a score, exactly like
// the model's default_error_value path, and never throws. The tensor constants are the vendor's
// and are not in this repository — they arrive at runtime from private object storage and are read
// through getCumulativeStressConstants(). See NOTICE.
//
// Library port only — not wired into any surface or the stress rollup (that is a follow-on;
// the chronic_stress_score / chronic_stress_contributors columns already exist from migration 123).

import { getCumulativeStressConstants } from './constants'

// Read on FIRST USE, memoised — not at module scope. `next build` imports every route to
// collect page data, so a module-scope read opened the constants file at build time, and the
// directory only exists at runtime now that the vendored copies are gone (Q-49 A4b). Each
// function below takes its own `const K = K_()` so the bodies read exactly as before.
let kCache: ReturnType<typeof getCumulativeStressConstants> | null = null
const K_ = (): ReturnType<typeof getCumulativeStressConstants> => (kCache ??= getCumulativeStressConstants())

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────
// Every series is a flat number[] (the .pt takes column vectors [N,1]; the port flattens on read).
// History series are the trailing 30/31-day windows; "latest" signals are the most recent night's
// raw samples. NaN marks a missing observation (the model is NaN-aware throughout).
export interface CumulativeStressInput {
  gotUps: number[]                    // [31] wake-up count per night
  lowestHeartRate: number[]           // [31]
  sleepPhase30Sec: number[]           // [M] latest-night hypnogram, 1=deep 2=light 3=rem 4=awake
  hrvItems: number[]                  // [K] latest-night rMSSD samples
  averageHrv: number[]                // [31]
  restingHrAverage: number[]          // [31]
  temperatureAvg: number[]            // [1] latest-night average skin temperature
  averageMetMinutes: number[]         // [30]
  longSleepHrv: number[]              // [31]
  hrvMedianHR5min: number[]           // [M2] latest-night 5-min median-HR HRV samples
  hrvQuality5min: number[]            // [M2]
  tempSkin: number[]                  // [T] latest-night skin-temperature samples
  sleepFragmentationIndex: number[]   // [30] history SFI
  normHrvMedianHR5min: number[]       // [30] history
  medianHrvQuality5min: number[]      // [30] history
  normalisedIqr: number[]             // [30] history
  normTempWake: number[]              // [30] history
  highestTemperature: number[]        // [31]
  temperatureDev: number[]            // [31]
  temperatureDevBaseline: number[]    // [31]
  totalSleepDuration: number[]        // [31] seconds
  nDaysToOvulation: number[]          // [1]
  nDaysToPeriod: number[]             // [1]
  cyclePhase: number[]                // [31] 0..1
  interpretedCyclePhase: number[]     // [30] 0..1 or NaN
  bedtimeStart: number[]              // [1] unix ms, -1 = missing
  tempSkinTimestamps: number[]        // [T] unix ms, [-1] = missing
}

export interface CumulativeStressResult {
  chronicStressScore: number          // 0–100 (NaN if a score cannot be produced)
  contributorFragmentation: number
  contributorHeart: number
  contributorSleepMotions: number
  contributorActivity: number
  contributorTemperature: number
  sleepFragmentationIndexLatest: number
  normHrvMedianHR5minLatest: number
  medianHrvQuality5minLatest: number
  normalisedIqrLatest: number
  normTempWakeLatest: number
  interpretedCyclePhaseLatest: number
  uiFragmentation: number
  uiHeart: number
  uiSleepMotions: number
  uiActivity: number
  uiTemperature: number
  clusterProba: number[]              // [5]
  debugMetrics: number[]              // [20]
}

// ── torch-faithful numeric helpers ───────────────────────────────────────────────────────────

const isNum = (x: number): boolean => !Number.isNaN(x)
const dropNaN = (a: number[]): number[] => a.filter(isNum)

function nanmean(a: number[]): number {
  const v = dropNaN(a)
  if (v.length === 0) return NaN
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

function nansum(a: number[]): number {
  // torch.sum over a bool/int mask (no NaNs here) — plain sum.
  let s = 0
  for (const x of a) s += x
  return s
}

// torch.median: on an even-length tensor returns the LOWER of the two middle values
// (element at floor((n−1)/2) of the sorted array), NOT the average.
function medianLowerMiddle(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

// utils.torch_median: the TRUE median (average of the two middle values on even n) over the
// non-NaN values — implemented as (median(cat(valid, max(valid))) + median(valid)) / 2 using
// torch.median's lower-middle semantics. Distinct from daily-baselines' torch.median.
function torchMedianTrue(a: number[]): number {
  const valid = dropNaN(a)
  if (valid.length === 0) return NaN
  const mx = Math.max(...valid)
  return (medianLowerMiddle([...valid, mx]) + medianLowerMiddle(valid)) / 2
}

// torch.std default: sample standard deviation (Bessel correction, ddof=1).
function torchStd(a: number[]): number {
  const n = a.length
  if (n < 2) return NaN
  const m = a.reduce((s, x) => s + x, 0) / n
  let ss = 0
  for (const x of a) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (n - 1))
}

// torch.quantile default: linear interpolation over the sorted values.
function torchQuantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y)
  if (s.length === 0) return NaN
  if (s.length === 1) return s[0]
  const pos = q * (s.length - 1)
  const lo = Math.floor(pos)
  const frac = pos - lo
  if (lo + 1 >= s.length) return s[s.length - 1]
  return s[lo] + frac * (s[lo + 1] - s[lo])
}

// torch.round: round half to even (banker's rounding).
function roundHalfEven(x: number): number {
  const r = Math.round(x)
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const f = Math.floor(x)
    return f % 2 === 0 ? f : f + 1
  }
  return r
}

// utils.torch_huber(x, c=1.5, tol=1e-5, max_iter=50, eps=1e-8): a robust SCALE estimate.
// Median/std seed, an outlier trim, then IRLS reweighting until |scale_new − scale| < tol.
// Returns the pre-convergence scale exactly as the traced loop does. NaN when no valid values.
function torchHuber(input: number[]): number {
  const valid = dropNaN(input)
  if (valid.length === 0) return NaN

  const c = 1.5
  const tol = 1e-5
  const maxIter = 50
  const eps = 1e-8

  let mu = torchMedianTrue(valid) // seed from the TRUE-median helper (utils.py)
  let scale = torchStd(valid)
  const p90 = torchQuantile(valid, 0.9)
  const r80 = p90 - torchQuantile(valid, 0.1)
  const outlierScale = Math.max(scale, r80)
  const vv = valid.filter((x) => x <= mu + outlierScale * 3.4 || x < p90 + 7)

  for (let it = 0; it < maxIter; it++) {
    if (scale < eps) break
    let wSum = 0
    let wxSum = 0
    const threshold = scale * c
    const weights: number[] = []
    for (const x of vv) {
      const absResid = Math.abs(x - mu)
      const w = absResid <= threshold ? 1 : threshold / (absResid + eps)
      weights.push(w)
      wSum += w
      wxSum += w * x
    }
    const mu1 = wxSum / wSum
    let vSum = 0
    for (let i = 0; i < vv.length; i++) {
      const resid = vv[i] - mu1
      vSum += weights[i] * resid * resid
    }
    const scaleNew = Math.sqrt(vSum / wSum)
    mu = mu1
    if (Math.abs(scaleNew - scale) < tol) break // converged → return the pre-update scale
    scale = scaleNew
  }
  return scale
}

// ── determine_cycle_phase (mangle_10) ────────────────────────────────────────────────────────
function determineCyclePhase(
  interpretedCyclePhase: number[],
  cyclePhase: number[],
  nDaysToOvulation: number[],
  nDaysToPeriod: number[],
): { finalInterpretedCyclePhase: number[]; interpretedCyclePhaseLatest: number } {
  // Fill NaNs in interpreted_cycle_phase from cycle_phase[:-1], then remaining NaNs → 0.
  const head = cyclePhase.slice(0, cyclePhase.length - 1) // cycle_phase[:-1]
  const filled = interpretedCyclePhase.map((v, i) => {
    let x = Number.isNaN(v) ? head[i] : v
    if (Number.isNaN(x)) x = 0
    return x
  })

  const ov = nDaysToOvulation[0]
  const pd = nDaysToPeriod[0]
  const invalidCycle =
    Number.isNaN(ov) || Math.abs(ov) > 40 || Number.isNaN(pd) || Math.abs(pd) > 40

  let latest: number
  if (invalidCycle) {
    latest = cyclePhase[cyclePhase.length - 1]
  } else {
    latest = ov < 0 || ov > pd ? 1 : 0
  }

  return { finalInterpretedCyclePhase: [...filled, latest], interpretedCyclePhaseLatest: latest }
}

// ── Preprocessor (mangle_8) ──────────────────────────────────────────────────────────────────

interface PreprocessOutput {
  gotUps: number[]
  lowestHeartRate: number[]
  averageHrv: number[]
  restingHrAverage: number[]
  temperatureAvg: number[]
  averageMetMinutes: number[]
  longSleepHrv: number[]
  normHrMin: number[]
  sleepFragmentationIndexLatest: number
  normHrvMedianHR5minLatest: number
  medianHrvQuality5minLatest: number
  normalisedIqrLatest: number
  medianbaselineRatioNhrv: number[]
  normTempWakeLatest: number
  totalSleepDuration: number[]
  feverMask31: number[]        // 0/1
  hrvCoverage: number
  sufficientSleepCheck: number // 0/1
}

function calculateSfi(hyp: number[]): number {
  if (hyp.every((x) => Number.isNaN(x))) return NaN
  let deepLightRem = 0
  let awakenings = 0
  for (const x of hyp) {
    if (x === 1 || x === 2 || x === 3) deepLightRem += 1
    if (x === 4) awakenings += 1
  }
  const totalSleepTime = deepLightRem
  if (totalSleepTime === 0) return NaN
  let differing = 0
  for (let i = 0; i < hyp.length - 1; i++) if (hyp[i] !== hyp[i + 1]) differing += 1
  const transitions = differing - 1
  const sfi = (awakenings + transitions) / (totalSleepTime / 120)
  return Math.min(sfi, 100)
}

function normaliseHrvMedianHR5min(hrvMedianHR5min: number[], restingHrAvg: number[]): number {
  const avg = nanmean(hrvMedianHR5min)
  return avg / restingHrAvg[restingHrAvg.length - 1]
}

function calculateNormIqr(hrvItems: number[]): { normalisedIqr: number; hrvCoverage: number } {
  const K = K_()
  const coverage = hrvItems.filter(isNum).length / hrvItems.length
  if (coverage < K.minHrvCoverage) return { normalisedIqr: NaN, hrvCoverage: coverage }
  const valid = dropNaN(hrvItems)
  if (valid.length === 0) return { normalisedIqr: NaN, hrvCoverage: coverage }
  const q75 = torchQuantile(valid, 0.75)
  const q25 = torchQuantile(valid, 0.25)
  const iqr = q75 - q25
  return { normalisedIqr: iqr / nanmean(valid), hrvCoverage: coverage }
}

function removeTempOutliers(tempWake: number[]): number[] {
  const K = K_()
  const belowFever = tempWake.filter((x) => x < K.feverLimit)
  const valid = dropNaN(belowFever)
  if (valid.length === 0) return [NaN]
  const q95 = torchQuantile(valid, 0.95)
  const q05 = torchQuantile(valid, 0.05)
  return valid.filter((x) => x >= q05 && x <= q95)
}

function normaliseTemperatureWake(
  tempSkin: number[],
  temperatureAvg: number[],
  sleepPhase30Sec: number[],
  bedtimeStart: number[],
  tempSkinTimestamps: number[],
): number {
  if (tempSkin.every((x) => Number.isNaN(x))) return NaN
  const bedtimeStartVal = bedtimeStart[0]
  if (bedtimeStartVal === -1) return NaN
  if (tempSkinTimestamps.length === 1 && tempSkinTimestamps[0] === -1) return NaN

  const bedtimeStart30s = Math.floor(bedtimeStartVal / 30) * 30
  let n1min = Math.trunc(sleepPhase30Sec.length / 2)
  let phase = sleepPhase30Sec
  if (n1min * 2 < sleepPhase30Sec.length) {
    n1min += 1
    phase = [...sleepPhase30Sec, -1]
  }

  // reshape [n1min, 2] then max over dim 1 → per-1-min stage.
  const maxStage: number[] = []
  for (let i = 0; i < n1min; i++) maxStage.push(Math.max(phase[2 * i], phase[2 * i + 1]))

  const sleepPhaseTimestamps: number[] = []
  for (let i = 0; i < n1min; i++) sleepPhaseTimestamps.push(i * 60 + bedtimeStart30s)

  // argmin |sleep_ts − temp_ts| over temp axis, and whether any diff < 5s.
  let anyWake = false
  const matchedTempIndices: number[] = []
  for (let i = 0; i < n1min; i++) {
    let best = Infinity
    let bestIdx = 0
    let matched = false
    for (let j = 0; j < tempSkinTimestamps.length; j++) {
      const d = Math.abs(sleepPhaseTimestamps[i] - tempSkinTimestamps[j])
      if (d < 5) matched = true
      if (d < best) {
        best = d
        bestIdx = j
      }
    }
    if (maxStage[i] === 4 && matched) {
      anyWake = true
      matchedTempIndices.push(bestIdx)
    }
  }
  if (!anyWake) return NaN

  const tempSkinWake = matchedTempIndices.map((idx) => tempSkin[idx])
  const clean = removeTempOutliers(tempSkinWake)
  if (clean.every((x) => Number.isNaN(x))) return NaN
  return nanmean(clean) / temperatureAvg[0]
}

function preprocess(i: {
  gotUps: number[]
  lowestHeartRate: number[]
  sleepPhase30Sec: number[]
  hrvItems: number[]
  averageHrv: number[]
  restingHrAverage: number[]
  temperatureAvg: number[]
  averageMetMinutes: number[]
  longSleepHrv: number[]
  hrvMedianHR5min: number[]
  hrvQuality5min: number[]
  tempSkin: number[]
  highestTemperature: number[]
  temperatureDev: number[]
  temperatureDevLimit: number[]
  totalSleepDuration: number[]
  bedtimeStart: number[]
  tempSkinTimestamps: number[]
}): PreprocessOutput {
  const K = K_()
  // drop_fever_outliers: fever_mask_31 = (highest_temp > fever_limit) | (temp_dev > temp_dev_limit)
  const feverMask31 = i.highestTemperature.map(
    (t, k) => (t > K.feverLimit || i.temperatureDev[k] > i.temperatureDevLimit[k] ? 1 : 0),
  )
  const feverMask30 = feverMask31.slice(0, feverMask31.length - 1)
  const feverMaskLatest = feverMask31[feverMask31.length - 1] === 1

  const nanWhere31 = (a: number[]): number[] => a.map((x, k) => (feverMask31[k] === 1 ? NaN : x))
  const gotUps = nanWhere31(i.gotUps)
  const lowestHeartRate = nanWhere31(i.lowestHeartRate)
  const averageHrv = nanWhere31(i.averageHrv)
  const restingHrAverage = nanWhere31(i.restingHrAverage)
  const longSleepHrv = nanWhere31(i.longSleepHrv)
  const totalSleepDuration = nanWhere31(i.totalSleepDuration)
  const averageMetMinutes = i.averageMetMinutes.map((x, k) => (feverMask30[k] === 1 ? NaN : x))

  let sleepPhase30Sec = i.sleepPhase30Sec
  let hrvQuality5min = i.hrvQuality5min
  let tempSkin = i.tempSkin
  if (feverMaskLatest) {
    sleepPhase30Sec = sleepPhase30Sec.map(() => NaN)
    hrvQuality5min = hrvQuality5min.map(() => NaN)
    tempSkin = tempSkin.map(() => NaN)
  }

  const sufficientSleepCheck =
    totalSleepDuration[totalSleepDuration.length - 1] / 60 / 60 >= 4 ? 1 : 0

  let sleepFragmentationIndexLatest = NaN
  let normHrvMedianHR5minLatest = NaN
  let medianHrvQuality5minLatest = NaN
  let normalisedIqrLatest = NaN
  let normTempWakeLatest = NaN
  let hrvCoverage = NaN
  if (sufficientSleepCheck === 1) {
    sleepFragmentationIndexLatest = calculateSfi(sleepPhase30Sec)
    normHrvMedianHR5minLatest = normaliseHrvMedianHR5min(i.hrvMedianHR5min, restingHrAverage)
    const iqr = calculateNormIqr(i.hrvItems)
    normalisedIqrLatest = iqr.normalisedIqr
    hrvCoverage = iqr.hrvCoverage
    medianHrvQuality5minLatest = nanmean(hrvQuality5min) / 100
    normTempWakeLatest = normaliseTemperatureWake(
      tempSkin,
      i.temperatureAvg,
      sleepPhase30Sec,
      i.bedtimeStart,
      i.tempSkinTimestamps,
    )
  }

  const normHrMin = lowestHeartRate.map((x, k) => x / restingHrAverage[k])
  const medianbaselineRatioNhrv = averageHrv.map((x, k) => x / longSleepHrv[k])

  return {
    gotUps,
    lowestHeartRate,
    averageHrv,
    restingHrAverage,
    temperatureAvg: i.temperatureAvg,
    averageMetMinutes,
    longSleepHrv,
    normHrMin,
    sleepFragmentationIndexLatest,
    normHrvMedianHR5minLatest,
    medianHrvQuality5minLatest,
    normalisedIqrLatest,
    medianbaselineRatioNhrv,
    normTempWakeLatest,
    totalSleepDuration,
    feverMask31,
    hrvCoverage,
    sufficientSleepCheck,
  }
}

// ── Processor (mangle_9) ─────────────────────────────────────────────────────────────────────

function factorAnalysisTransform(X: number[]): number[] {
  const K = K_()
  // scores = ((X − mean) / std) @ weights  → [6]
  const xScale = X.map((x, k) => (x - K.faModelMean[k]) / K.faModelStd[k])
  const scores: number[] = []
  for (let f = 0; f < 6; f++) {
    let s = 0
    for (let k = 0; k < 9; k++) s += xScale[k] * K.faModelWeights[k * 6 + f]
    scores.push(s)
  }
  return scores
}

function factorAnalysisDropDim(scores: number[]): number[] {
  const K = K_()
  // drop index dim_to_drop (0) → 5 values
  return scores.filter((_, k) => k !== K.dimToDrop)
}

function estimateClusterProba(fa: number[]): { positiveClusterProba: number; clusterProba: number[] } {
  const K = K_()
  // per-centroid Frobenius (euclidean) distance, then softmin (= softmax of −dist).
  const dist: number[] = []
  for (let cIdx = 0; cIdx < 5; cIdx++) {
    let ss = 0
    for (let k = 0; k < 5; k++) {
      const d = K.clusterCentroids[cIdx * 5 + k] - fa[k]
      ss += d * d
    }
    dist.push(Math.sqrt(ss))
  }
  const neg = dist.map((d) => -d)
  const mx = Math.max(...neg)
  const exps = neg.map((v) => Math.exp(v - mx))
  const sum = exps.reduce((a, b) => a + b, 0)
  const clusterProba = exps.map((e) => e / sum)
  let positive = 0
  for (const idx of K.positiveClusters) positive += clusterProba[idx]
  return { positiveClusterProba: positive, clusterProba }
}

function scaleContributors(fa: number[]): number[] {
  const K = K_()
  return fa.map((v, k) => {
    const x = v - K.contributorMeans[k]
    const scaled = x > 0 ? x / K.contributor99p[k] : x / -K.contributor01p[k]
    return Math.max(-1, Math.min(1, scaled)) * 100
  })
}

interface EstimateOutput {
  chronicStressScore: number
  contributors: number[] // scaled [5]
  clusterProba: number[]
}

function estimate(p: {
  gotUps: number[]
  totalSleepDuration: number[]
  normHrMin: number[]
  sleepFragmentationIndex: number[]
  normHrvMedianHR5min: number[]
  medianHrvQuality5min: number[]
  averageMetMinutes: number[]
  normalisedIqr: number[]
  medianbaselineRatioNhrv: number[]
  normTempWake: number[]
}): EstimateOutput {
  const normGotUpsHuber = torchHuber(p.gotUps) / (nanmean(p.totalSleepDuration) / 60 / 60)
  const X = [
    normGotUpsHuber,
    torchMedianTrue(p.normHrMin),
    torchMedianTrue(p.sleepFragmentationIndex),
    torchMedianTrue(p.normHrvMedianHR5min),
    torchMedianTrue(p.medianHrvQuality5min),
    torchMedianTrue(p.averageMetMinutes),
    torchMedianTrue(p.normalisedIqr),
    torchMedianTrue(p.medianbaselineRatioNhrv),
    torchMedianTrue(p.normTempWake),
  ]
  const fa = factorAnalysisDropDim(factorAnalysisTransform(X))
  const { positiveClusterProba, clusterProba } = estimateClusterProba(fa)
  const contributors = scaleContributors(fa)
  return { chronicStressScore: roundHalfEven(positiveClusterProba * 100), contributors, clusterProba }
}

// ── get_ui_contributors (mangle_10) ──────────────────────────────────────────────────────────
// Piecewise-linear remap of each signed contributor through the contributor_levels table into a
// 0–100 UI level. contributor_levels is [5 levels × 6 cols]: col 0 = UI level value; cols 1..5 =
// the per-contributor raw thresholds at that level.
function getUiContributors(rawContributors: number[]): number[] {
  const K = K_()
  const levels = K.contributorLevels // [5][6] row-major
  const uiLevel = [0, 1, 2, 3, 4].map((r) => levels[r * 6 + 0]) // [100,85,70,60,0]
  const uiUpper = uiLevel.slice(0, 4) // [:-1]
  const uiLower = uiLevel.slice(1) // [1:]

  // raw thresholds per contributor: rawThresholds[level][contributor] = levels[level][1+contributor]
  const rawUpperLevel: number[][] = [] // rows 0..3
  const rawLowerLevel: number[][] = [] // rows 1..4
  for (let r = 0; r < 4; r++) {
    rawUpperLevel.push([0, 1, 2, 3, 4].map((cIdx) => levels[r * 6 + 1 + cIdx]))
    rawLowerLevel.push([0, 1, 2, 3, 4].map((cIdx) => levels[(r + 1) * 6 + 1 + cIdx]))
  }

  return rawContributors.map((raw, cIdx) => {
    const rawInput = raw * -1
    // The .pt sums mask·(rawInput·slope+intercept) over all bands; a NaN rawInput makes every
    // term 0·NaN = NaN, so the whole UI level is NaN (the default-error path).
    if (Number.isNaN(rawInput)) return NaN
    let out = 0
    for (let band = 0; band < 4; band++) {
      const rawUpper = rawUpperLevel[band][cIdx]
      const rawLower = rawLowerLevel[band][cIdx]
      if (rawInput >= rawUpper && rawInput < rawLower) {
        const slope = (uiLower[band] - uiUpper[band]) / (rawLower - rawUpper)
        const intercept = uiLower[band] - slope * rawLower
        out += rawInput * slope + intercept
      }
    }
    return out
  })
}

// ── enhanced_final_check (mangle_10) ─────────────────────────────────────────────────────────
function enhancedFinalCheck(p: {
  gotUps: number[]
  normHrMin: number[]
  sleepFragmentationIndex: number[]
  normHrvMedianHR5min: number[]
  medianHrvQuality5min: number[]
  averageMetMinutes: number[]
  normalisedIqr: number[]
  medianbaselineRatioNhrv: number[]
  normTempWake: number[]
  highestTemperature: number[]
  temperatureDev: number[]
  temperatureDevLimit: number[]
  sufficientSleepCheck: number
}): { finalCheckResult: number; fever: number; canProduceScore: number; canProduceIntermediates: number } {
  const K = K_()
  const lastHi = p.highestTemperature[p.highestTemperature.length - 1]
  const lastDev = p.temperatureDev[p.temperatureDev.length - 1]
  const lastLimit = p.temperatureDevLimit[p.temperatureDevLimit.length - 1]
  const fever = lastHi > K.feverLimit || lastDev > lastLimit ? 1 : 0

  const required = [
    p.sleepFragmentationIndex,
    p.normHrvMedianHR5min,
    p.medianHrvQuality5min,
    p.normalisedIqr,
    p.normTempWake,
    p.normHrMin,
    p.averageMetMinutes,
    p.medianbaselineRatioNhrv,
    p.gotUps,
  ]
  let notEnough = 0
  for (const t of required) {
    if (t.filter(isNum).length < K.minDaysRequired) notEnough += 1
  }

  const canProduceScore = notEnough === 0 ? 1 : 0
  const canProduceIntermediates = p.sufficientSleepCheck === 1 ? 1 : 0

  let finalCheckResult: number
  if (notEnough === 0) {
    finalCheckResult = 0
  } else if (p.sufficientSleepCheck === 1 && fever === 0) {
    finalCheckResult = 0
  } else if (p.sufficientSleepCheck === 1 && fever === 1) {
    finalCheckResult = 16
  } else {
    finalCheckResult = 14
  }
  return { finalCheckResult, fever, canProduceScore, canProduceIntermediates }
}

// ── top forward (mangle_10) ──────────────────────────────────────────────────────────────────

const NAN_RESULT: CumulativeStressResult = {
  chronicStressScore: NaN,
  contributorFragmentation: NaN,
  contributorHeart: NaN,
  contributorSleepMotions: NaN,
  contributorActivity: NaN,
  contributorTemperature: NaN,
  sleepFragmentationIndexLatest: NaN,
  normHrvMedianHR5minLatest: NaN,
  medianHrvQuality5minLatest: NaN,
  normalisedIqrLatest: NaN,
  normTempWakeLatest: NaN,
  interpretedCyclePhaseLatest: NaN,
  uiFragmentation: NaN,
  uiHeart: NaN,
  uiSleepMotions: NaN,
  uiActivity: NaN,
  uiTemperature: NaN,
  clusterProba: [NaN, NaN, NaN, NaN, NaN],
  debugMetrics: new Array(20).fill(NaN),
}

/** Run the cumulative-stress (ChronicStress) model. Returns the score, contributors, UI levels,
 *  cluster probabilities and debug intermediates. Never throws — when a score cannot be produced
 *  it returns the model's default-error (NaN) values (the `can_produce_score == 0` branch). */
export function runCumulativeStress(input: CumulativeStressInput): CumulativeStressResult {
  const K = K_()
  // 1. Pre-clean: hrv_medianHR_5min values < 1 → NaN.
  const hrvMedianHR5min = input.hrvMedianHR5min.map((x) => (x < 1 ? NaN : x))

  // 2. Validator → pragmatic gate. The captured golden input is valid; a malformed shape yields
  //    the all-NaN default path rather than a raised exception.
  if (
    input.gotUps.length === 0 ||
    input.cyclePhase.length === 0 ||
    input.nDaysToOvulation.length === 0 ||
    input.nDaysToPeriod.length === 0 ||
    input.totalSleepDuration.length === 0
  ) {
    return NAN_RESULT
  }

  // 3. bedtime_start, temp_skin_timestamps: ms → s (floor).
  const bedtimeStart = input.bedtimeStart.map((x) => Math.floor(x / 1000))
  const tempSkinTimestamps = input.tempSkinTimestamps.map((x) => Math.floor(x / 1000))

  // 4. determine_cycle_phase.
  const { finalInterpretedCyclePhase, interpretedCyclePhaseLatest } = determineCyclePhase(
    input.interpretedCyclePhase,
    input.cyclePhase,
    input.nDaysToOvulation,
    input.nDaysToPeriod,
  )

  // 5. temperature_dev_limit = baseline + final_interpreted_cycle_phase * luteal_phase_correction.
  const temperatureDevLimit = input.temperatureDevBaseline.map(
    (b, k) => b + finalInterpretedCyclePhase[k] * K.lutealPhaseCorrection,
  )

  // 6. Preprocessor.
  const pp = preprocess({
    gotUps: input.gotUps,
    lowestHeartRate: input.lowestHeartRate,
    sleepPhase30Sec: input.sleepPhase30Sec,
    hrvItems: input.hrvItems,
    averageHrv: input.averageHrv,
    restingHrAverage: input.restingHrAverage,
    temperatureAvg: input.temperatureAvg,
    averageMetMinutes: input.averageMetMinutes,
    longSleepHrv: input.longSleepHrv,
    hrvMedianHR5min,
    hrvQuality5min: input.hrvQuality5min,
    tempSkin: input.tempSkin,
    highestTemperature: input.highestTemperature,
    temperatureDev: input.temperatureDev,
    temperatureDevLimit,
    totalSleepDuration: input.totalSleepDuration,
    bedtimeStart,
    tempSkinTimestamps,
  })

  // 7. Concatenate history + latest for the five series features.
  const sfiSeries = [...input.sleepFragmentationIndex, pp.sleepFragmentationIndexLatest].map(
    (x) => x / 100,
  )
  const nhrvSeries = [...input.normHrvMedianHR5min, pp.normHrvMedianHR5minLatest]
  const mhqSeries = [...input.medianHrvQuality5min, pp.medianHrvQuality5minLatest]
  const niqrSeries = [...input.normalisedIqr, pp.normalisedIqrLatest]
  const ntwSeries = [...input.normTempWake, pp.normTempWakeLatest]

  // 8. enhanced_final_check.
  const efc = enhancedFinalCheck({
    gotUps: pp.gotUps,
    normHrMin: pp.normHrMin,
    sleepFragmentationIndex: sfiSeries,
    normHrvMedianHR5min: nhrvSeries,
    medianHrvQuality5min: mhqSeries,
    averageMetMinutes: pp.averageMetMinutes,
    normalisedIqr: niqrSeries,
    medianbaselineRatioNhrv: pp.medianbaselineRatioNhrv,
    normTempWake: ntwSeries,
    highestTemperature: input.highestTemperature,
    temperatureDev: input.temperatureDev,
    temperatureDevLimit,
    sufficientSleepCheck: pp.sufficientSleepCheck,
  })

  // debug_metrics (20) — assembled the way the .pt stacks them.
  const debugMetrics = [
    efc.fever,
    input.temperatureDev[input.temperatureDev.length - 1],
    temperatureDevLimit[temperatureDevLimit.length - 1],
    input.cyclePhase[input.cyclePhase.length - 1],
    pp.hrvCoverage,
    pp.sufficientSleepCheck,
    Number.isNaN(pp.averageMetMinutes[pp.averageMetMinutes.length - 1]) ? 1 : 0,
    pp.gotUps.filter(isNum).length,
    pp.totalSleepDuration.filter(isNum).length,
    pp.normHrMin.filter(isNum).length,
    sfiSeries.filter(isNum).length,
    nhrvSeries.filter(isNum).length,
    mhqSeries.filter(isNum).length,
    pp.averageMetMinutes.filter(isNum).length,
    niqrSeries.filter(isNum).length,
    pp.medianbaselineRatioNhrv.filter(isNum).length,
    ntwSeries.filter(isNum).length,
    nansum(pp.feverMask31),
    efc.canProduceScore,
    efc.canProduceIntermediates,
  ]

  // 9. Processor (only when a score can be produced).
  let chronicStressScore = NaN
  let contributorFragmentation = NaN
  let contributorHeart = NaN
  let contributorSleepMotions = NaN
  let contributorActivity = NaN
  let contributorTemperature = NaN
  let clusterProba = [NaN, NaN, NaN, NaN, NaN]

  if (efc.canProduceScore > 0.5) {
    const est = estimate({
      gotUps: pp.gotUps,
      totalSleepDuration: pp.totalSleepDuration,
      normHrMin: pp.normHrMin,
      sleepFragmentationIndex: sfiSeries,
      normHrvMedianHR5min: nhrvSeries,
      medianHrvQuality5min: mhqSeries,
      averageMetMinutes: pp.averageMetMinutes,
      normalisedIqr: niqrSeries,
      medianbaselineRatioNhrv: pp.medianbaselineRatioNhrv,
      normTempWake: ntwSeries,
    })
    chronicStressScore = est.chronicStressScore
    contributorFragmentation = est.contributors[0] * -1
    contributorHeart = est.contributors[1] * -1
    contributorSleepMotions = est.contributors[2] * -1
    contributorActivity = est.contributors[3] * -1
    contributorTemperature = est.contributors[4]
    clusterProba = est.clusterProba
  }

  // 10. get_ui_contributors.
  const [uiFragmentation, uiHeart, uiSleepMotions, uiActivity, uiTemperature] = getUiContributors([
    contributorFragmentation,
    contributorHeart,
    contributorSleepMotions,
    contributorActivity,
    contributorTemperature,
  ])

  return {
    chronicStressScore,
    contributorFragmentation,
    contributorHeart,
    contributorSleepMotions,
    contributorActivity,
    contributorTemperature,
    sleepFragmentationIndexLatest: pp.sleepFragmentationIndexLatest,
    normHrvMedianHR5minLatest: pp.normHrvMedianHR5minLatest,
    medianHrvQuality5minLatest: pp.medianHrvQuality5minLatest,
    normalisedIqrLatest: pp.normalisedIqrLatest,
    normTempWakeLatest: pp.normTempWakeLatest,
    interpretedCyclePhaseLatest,
    uiFragmentation,
    uiHeart,
    uiSleepMotions,
    uiActivity,
    uiTemperature,
    clusterProba,
    debugMetrics,
  }
}

// ── Night-intermediate wrapper (rollup history assembly) ──────────────────────────────────────
// The five 30-day history series (`sleepFragmentationIndex`, `normHrvMedianHR5min`,
// `medianHrvQuality5min`, `normalisedIqr`, `normTempWake`) are each prior night's preprocessor
// "latest" output. `runCumulativeStress` computes and returns those for the latest night; this
// thin wrapper exposes the same computation for a single prior night so the rollup can build the
// history arrays in memory (plan §3B — recompute-in-memory, no stored intermediates). It re-runs
// only the (private) `preprocess` half over 1-element windows — a re-export of already-golden math,
// no algorithm change — so the golden test is unaffected. Male-user simplification: no menstrual
// cycle, so `temperature_dev_limit == temperature_dev_baseline` (the luteal correction is × 0).

export interface NightIntermediateSignals {
  sleepPhase30Sec: number[]
  hrvItems: number[]
  hrvMedianHR5min: number[]
  hrvQuality5min: number[]
  tempSkin: number[]
  tempSkinTimestamps: number[] // unix ms, [-1] = missing
  temperatureAvg: number // this night's average skin temperature
  bedtimeStart: number // unix ms, -1 = missing
  restingHrAvg: number // this night's rhrAvgBpm (denominator of normHrvMedianHR5min)
  totalSleepDurationSec: number
  highestTemperature: number
  temperatureDev: number
  temperatureDevBaseline: number
}

export interface NightIntermediates {
  sleepFragmentationIndex: number
  normHrvMedianHR5min: number
  medianHrvQuality5min: number
  normalisedIqr: number
  normTempWake: number
}

export function computeNightIntermediates(n: NightIntermediateSignals): NightIntermediates {
  const pp = preprocess({
    gotUps: [NaN],
    lowestHeartRate: [NaN],
    sleepPhase30Sec: n.sleepPhase30Sec,
    hrvItems: n.hrvItems,
    averageHrv: [NaN],
    restingHrAverage: [n.restingHrAvg],
    temperatureAvg: [n.temperatureAvg],
    averageMetMinutes: [NaN],
    longSleepHrv: [NaN],
    hrvMedianHR5min: n.hrvMedianHR5min.map((x) => (x < 1 ? NaN : x)),
    hrvQuality5min: n.hrvQuality5min,
    tempSkin: n.tempSkin,
    highestTemperature: [n.highestTemperature],
    temperatureDev: [n.temperatureDev],
    temperatureDevLimit: [n.temperatureDevBaseline],
    totalSleepDuration: [n.totalSleepDurationSec],
    bedtimeStart: [Math.floor(n.bedtimeStart / 1000)],
    tempSkinTimestamps: n.tempSkinTimestamps.map((x) => Math.floor(x / 1000)),
  })
  return {
    sleepFragmentationIndex: pp.sleepFragmentationIndexLatest,
    normHrvMedianHR5min: pp.normHrvMedianHR5minLatest,
    medianHrvQuality5min: pp.medianHrvQuality5minLatest,
    normalisedIqr: pp.normalisedIqrLatest,
    normTempWake: pp.normTempWakeLatest,
  }
}
