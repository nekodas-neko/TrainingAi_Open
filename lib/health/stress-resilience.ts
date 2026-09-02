// Stress-resilience (stress_resilience_2_2_1) — a faithful TypeScript port of the
// 0-parameter algorithmic TorchScript model (Validator/Preprocessor/Processor). Pinned to a
// captured .pt golden vector (lib/oura-models/onnx/__fixtures__/…golden.json, < 1e-3). Do NOT
// "improve" the algorithm or re-derive constants — the vendored constants (getResilienceConstants)
// and the golden are the source of truth. Ported from the vendor's `stress_resilience_2_2_1` model
// source (private archive).
import type { ResilienceConstants } from '@/lib/oura-models/constants'
import { daytimeStressScalingParams } from '@/lib/health/daytime-stress'

// The constants are INJECTED, not read from disk here (Q-545). Importing the loader put `node:fs`
// in this module's graph, and the Oura rollup imports this file — which is what kept a rollup that
// is otherwise runtime-agnostic from ever running in the WebView. Same mechanism
// `steps-motion-decoder` has used since Q-221. Each function below still takes its own
// `const C = C_()`, so the bodies read exactly as before.
let cCache: ResilienceConstants | null = null

/** Provide the resilience constants. Server: `ensureServerOuraConstants()`. */
export function setResilienceConstants(c: ResilienceConstants): void {
  cCache = c
}

export function hasResilienceConstants(): boolean {
  return cCache !== null
}

/** Test-only: forget the injected constants so a test can assert the unset behaviour. */
export function __clearResilienceConstants(): void {
  cCache = null
}

// Throws rather than defaulting, deliberately — the same call the disk loader used to make. This
// port is pinned to a captured golden vector; with no constants it would emit plausible, wrong
// resilience scores rather than fail.
const C_ = (): ResilienceConstants => {
  if (!cCache) {
    throw new Error(
      'stress-resilience: constants not set — call setResilienceConstants() first ' +
        '(server: ensureServerOuraConstants() from lib/oura-models/constants/server-inject)',
    )
  }
  return cCache
}

export interface ResilienceModelInput {
  sleepStartTimestampsMs: number[]
  sleepEndTimestampsMs: number[]
  sleepScore: number
  hrvBalance: number            // may be NaN (allowed)
  recoveryIndex: number
  restingHeartRate: number      // 0-100 contributor score
  stressLim: number
  saturationStressDeviation: number
  saturationRecoveryDeviation: number
  recoveryLim: number
  stress: number[]              // daytime stress series
  stressTimestampsMs: number[]
  dailyStressList: number[]     // trailing ≤13 persisted indices (may contain NaN)
  dailyRestorativeTimeList: number[]
  dailySleepRecoveryList: number[]
}

export interface ResilienceModelOutput {
  dailyStress: number
  dailyRestorativeTime: number
  dailySleepRecovery: number
  dailyQuantizedStress: number
  dailyQuantizedRestorativeTime: number
  dailyQuantizedSleepRecovery: number
  longTermRestorativeTime: number
  longTermSleepRecovery: number
  longTermRecovery: number
  longTermStress: number
  resilienceLevel: number       // 1-5 banded, or NaN when the window has <min_length valid days
  granularResilienceLevel: number
  confidence: number
  /** Minutes of daytime stress coverage this day actually had — `resolutionMinutes × non-NaN
   *  resampled buckets`, the LEFT side of `final_check_stress_coverage`. 0 when the series produced
   *  no buckets at all. Reported on every branch, including the failing one: a day that produces no
   *  index is exactly the day this number explains (Q-510). */
  daytimeStressCoverageMin: number
}

const nansum = (a: number[]): number => a.reduce((s, v) => (Number.isNaN(v) ? s : s + v), 0)
const nanmean = (a: number[]): number => {
  const v = a.filter(x => !Number.isNaN(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN
}

// polyval (Horner): coefs high→low degree. r=0; for c: r = r*x + c.
function polyval(coefs: number[], x: number): number {
  let r = 0
  for (const c of coefs) r = r * x + c
  return r
}

// ── Preprocessor (___torch_mangle_8) ────────────────────────────────────────────────
// Remove stress samples that fall within any sleep period; resample the remainder into
// resolution-minute buckets (mean per bucket, gaps → NaN). Returns null when there's no
// daytime stress left (the "Insufficient stress" branch).
function preprocessStress(i: ResilienceModelInput): { quantized: number[]; ok: boolean; coverageBuckets: number } | null {
  const C = C_()
  // omit_sleep_values
  const kept: { s: number; ts: number }[] = []
  const nPeriods = Math.min(i.sleepStartTimestampsMs.length, i.sleepEndTimestampsMs.length)
  for (let k = 0; k < i.stress.length; k++) {
    const ts = i.stressTimestampsMs[k]
    let inSleep = false
    for (let p = 0; p < nPeriods; p++) {
      if (ts >= i.sleepStartTimestampsMs[p] && ts <= i.sleepEndTimestampsMs[p]) { inSleep = true; break }
    }
    if (!inSleep) kept.push({ s: i.stress[k], ts })
  }
  if (kept.length === 0) return null

  // resample_stress_values — clamp into [sat_stress, sat_recovery], bucket by resolution*60s
  const resampleInterval = C.resolutionMinutes * 60 // seconds
  const clamp = (v: number) => {
    let x = v
    if (x < i.saturationStressDeviation) x = i.saturationStressDeviation
    if (x > i.saturationRecoveryDeviation) x = i.saturationRecoveryDeviation
    return x
  }
  const buckets = new Map<number, number[]>()
  for (const { s, ts } of kept) {
    if (Number.isNaN(s)) continue
    const sec = Math.trunc(ts / 1000)
    const key = sec - (sec % resampleInterval)
    const arr = buckets.get(key) ?? []
    if (arr.length < 10) arr.push(clamp(s))     // max_n_obs_per_bucket = 10
    buckets.set(key, arr)
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b)
  if (keys.length === 0) return null
  const meanByKey = new Map(keys.map(k => [k, nanmean(buckets.get(k)!)]))
  // equidistant timestamps arange(min, max+interval, interval); missing → NaN
  const minK = keys[0], maxK = keys[keys.length - 1]
  const resampled: number[] = []
  for (let t = minK; t < maxK + resampleInterval; t += resampleInterval) {
    resampled.push(meanByKey.has(t) ? meanByKey.get(t)! : NaN)
  }

  // final_check_stress_coverage
  const nonNan = resampled.filter(v => !Number.isNaN(v))
  const ok = C.resolutionMinutes * nonNan.length >= C.minDaytimeStressHours * 60

  // quantize_stress_recovery_magnitude → the 7 bucket counts (on non-NaN values)
  const st = nonNan
  const sl = i.stressLim, sat_s = i.saturationStressDeviation, sat_r = i.saturationRecoveryDeviation, rl = i.recoveryLim
  const mth = C.moderateToHighCoef, ltm = C.lowToModerateCoef
  const count = (pred: (v: number) => boolean) => st.filter(pred).length
  const high_stress = count(v => v < sl + (sat_s - sl) * mth)
  const moderate_stress = count(v => v >= sl + (sat_s - sl) * mth && v < sl + (sat_s - sl) * ltm)
  const low_stress = count(v => v >= sl + (sat_s - sl) * ltm && v < sl)
  const neutral = count(v => v >= sl && v <= rl)
  const low_recovery = count(v => v > rl && v <= rl + (sat_r - rl) * ltm)
  const moderate_recovery = count(v => v > rl + (sat_r - rl) * ltm && v <= rl + (sat_r - rl) * mth)
  const high_recovery = count(v => v > rl + (sat_r - rl) * mth)
  // order matches the .pt tuple: (high_stress, moderate_stress, low_stress, neutral, low_recovery, moderate_recovery, high_recovery)
  // `coverageBuckets` is `nonNan.length` — the left side of the gate above, which was computed and
  // then discarded. Q-510: without it "why did resilience produce nothing today" is unanswerable
  // from data, because neither side of the inequality was persisted anywhere.
  return { quantized: [high_stress, moderate_stress, low_stress, neutral, low_recovery, moderate_recovery, high_recovery], ok, coverageBuckets: nonNan.length }
}

// ── Stage 1 quantize bands (___torch_mangle_9 quantize_daily_indeces) ─────────────────
function bandStress(v: number): number {
  if (v > 0 && v < 39) return 1
  if (v >= 39 && v < 46) return 2
  if (v >= 46 && v < 51) return 3
  if (v >= 51 && v < 60) return 4
  if (v >= 60 && v < 68) return 5
  if (v >= 68 && v < 76) return 6
  if (v >= 76 && v < 84) return 7
  if (v >= 84 && v <= 100) return 8
  return 0
}
function bandRestorative(v: number): number {
  if (v > 0 && v < 7) return 1
  if (v >= 7 && v < 13) return 2
  if (v >= 13 && v < 17) return 3
  if (v >= 17 && v < 24) return 4
  if (v >= 24 && v < 31) return 5
  if (v >= 31 && v < 40) return 6
  if (v >= 40 && v < 45) return 7
  if (v >= 45 && v < 53) return 8
  if (v >= 53 && v <= 100) return 9
  return 0
}
function bandSleepRecovery(v: number): number {
  if (v > 0 && v < 34) return 1
  if (v >= 34 && v < 39) return 2
  if (v >= 39 && v < 43) return 3
  if (v >= 43 && v < 48) return 4
  if (v >= 48 && v < 53) return 5
  if (v >= 53 && v < 58) return 6
  if (v >= 58 && v < 62) return 7
  if (v >= 62 && v < 67) return 8
  if (v >= 67 && v <= 100) return 9
  return 0
}

// ── Stage 2 banding (___torch_mangle_9 label / find_granular) ─────────────────────────
function labelResilienceLevel(recovery: number, stress: number): number {
  const C = C_()
  const base = polyval(C.planeFitCoef, stress)
  for (let k = 0; k < 4; k++) {
    if (recovery < base + C.pcaMinorAxisLength * C.levelMultiplier[k]) return k + 1
  }
  return 5
}

function findGranularResilienceLevel(recovery: number, stress: number, level: number): number {
  const C = C_()
  const base = polyval(C.planeFitCoef, stress)
  const y = (k: number) => base + C.pcaMinorAxisLength * C.levelMultiplier[k]
  let granular: number
  if (level === 2 || level === 3 || level === 4) {
    const yAbove = y(level - 1)
    const yBelow = y(level - 2)
    granular = level + (recovery - yBelow) / (yAbove - yBelow)
  } else {
    const maxDistance = y(2) - y(1)
    if (level === 1) {
      const yAbove = y(0)
      const d = yAbove - recovery
      const dec = d > maxDistance ? 0.99 : d / maxDistance
      granular = level + 1 - dec
    } else if (level === 5) {
      const yBelow = y(3)
      const d = recovery - yBelow
      const dec = d > maxDistance ? 0.99 : d / maxDistance
      granular = level + dec
    } else {
      granular = NaN
    }
  }
  granular = Math.round(granular * 100) / 100
  return Math.max(1.01, Math.min(5.99, granular))
}

/** Run the full stress-resilience model. Infallible — returns the 13 model outputs; the
 *  resilience level/granular are NaN when the window has < window_min_length valid days or the
 *  daytime stress coverage is insufficient (the .pt's default_error_value branches). */
export function runStressResilience(i: ResilienceModelInput): ResilienceModelOutput {
  const C = C_()
  const pre = preprocessStress(i)

  let dailyStress: number, dailyRestorativeTime: number, dailySleepRecovery: number
  let qStress: number, qRestorative: number, qSleepRecovery: number

  if (pre && pre.ok) {
    const q = pre.quantized
    const sumStress = q[0] * C.highWeight + q[1] * C.moderateWeight + q[2] * C.lowWeight
    const sumRecovery = q[6] * C.highWeight + q[5] * C.moderateWeight + q[4] * C.lowWeight
    const sumNeutral = q[3] * C.neutralWeight
    const sumTotal = sumStress + sumRecovery + sumNeutral
    dailyStress = C.percentMultiplier * (sumStress / sumTotal)
    dailyRestorativeTime = C.percentMultiplier * (sumRecovery / sumTotal)

    let sr: number
    if (Number.isNaN(i.hrvBalance)) {
      const num = i.sleepScore * C.sleepScoreWeight + i.recoveryIndex * C.recoveryIndexWeight + i.restingHeartRate * C.restingHeartRateWeight
      sr = num / (C.sleepScoreWeight + C.recoveryIndexWeight + C.restingHeartRateWeight)
    } else {
      const num = i.sleepScore * C.sleepScoreWeight + i.hrvBalance * C.hrvBalanceWeight + i.recoveryIndex * C.recoveryIndexWeight + i.restingHeartRate * C.restingHeartRateWeight
      sr = num / (C.sleepScoreWeight + C.hrvBalanceWeight + C.recoveryIndexWeight + C.restingHeartRateWeight)
    }
    dailySleepRecovery = Math.max(0, Math.min(100, polyval(C.sleepRecoveryScalerCoef, sr)))
    qStress = bandStress(dailyStress)
    qRestorative = bandRestorative(dailyRestorativeTime)
    qSleepRecovery = bandSleepRecovery(dailySleepRecovery)
  } else {
    // Insufficient stress → default error (NaN) daily indices; quantized default to 0.
    dailyStress = NaN; dailyRestorativeTime = NaN; dailySleepRecovery = NaN
    qStress = 0; qRestorative = 0; qSleepRecovery = 0
  }

  // Append today's daily indices to the rolling lists, then fit the window.
  const stressList = [...i.dailyStressList, dailyStress]
  const restorativeList = [...i.dailyRestorativeTimeList, dailyRestorativeTime]
  const sleepRecoveryList = [...i.dailySleepRecoveryList, dailySleepRecovery]
  const validCount = stressList.filter(v => !Number.isNaN(v)).length

  let longTermRestorativeTime = NaN, longTermSleepRecovery = NaN, longTermRecovery = NaN, longTermStress = NaN
  let resilienceLevel = NaN, granular = NaN
  let confidence = NaN

  if (validCount >= C.windowMinLength) {
    // weights = linspace(last_period_weight, today_weight, window_length). The .pt threads a
    // fixed window_length window (older days NaN-padded); align by left-padding the lists to
    // window_length so weights map 1:1 (newest = today = highest weight).
    const n = C.windowLength
    const weights: number[] = []
    for (let k = 0; k < n; k++) weights.push(C.lastPeriodWeight + (C.todayWeight - C.lastPeriodWeight) * (k / (n - 1)))
    const pad = (a: number[]) => a.length >= n ? a.slice(a.length - n) : [...Array(n - a.length).fill(NaN), ...a]
    const sList = pad(stressList), rList = pad(restorativeList), srList = pad(sleepRecoveryList)

    // sum_of_weights_used is computed ONCE from the STRESS list's non-NaN mask and reused for all
    // three long-term aggregates (faithful to the .pt — ___torch_mangle_9 estimate_resilience_level).
    const sumUsed = sList.reduce((s, v, k) => (Number.isNaN(v) ? s : s + weights[k]), 0)
    longTermStress = nansum(sList.map((v, k) => v * weights[k])) / sumUsed
    longTermRestorativeTime = nansum(rList.map((v, k) => v * weights[k])) / sumUsed
    // daily_sleep_recovery is 1-D in the .pt (stress/restorative are 2-D column vectors), so
    // `list × weights[N,1]` broadcasts to [N,N]: nansum = (Σ weights)·nansum(list). Replicated here.
    const wAllSum = weights.reduce((s, x) => s + x, 0)
    longTermSleepRecovery = (wAllSum * nansum(srList)) / sumUsed
    longTermRecovery = C.daytimeRecoveryWeight * longTermRestorativeTime + C.sleepRecoveryWeight * longTermSleepRecovery
    resilienceLevel = labelResilienceLevel(longTermRecovery, longTermStress)
    granular = findGranularResilienceLevel(longTermRecovery, longTermStress, resilienceLevel)
    confidence = validCount / C.windowLength
  }

  return {
    dailyStress, dailyRestorativeTime, dailySleepRecovery,
    dailyQuantizedStress: qStress, dailyQuantizedRestorativeTime: qRestorative, dailyQuantizedSleepRecovery: qSleepRecovery,
    longTermRestorativeTime, longTermSleepRecovery, longTermRecovery, longTermStress,
    resilienceLevel, granularResilienceLevel: granular, confidence,
    daytimeStressCoverageMin: C.resolutionMinutes * (pre?.coverageBuckets ?? 0),
  }
}

/** 1.0–5.0 → Oura's band vocabulary (matches the frozen-Cloud label strings). */
export function resilienceLevelToBand(level: number): 'low' | 'limited' | 'adequate' | 'solid' | 'strong' {
  const l = Math.round(level)
  return l <= 1 ? 'low' : l === 2 ? 'limited' : l === 3 ? 'adequate' : l === 4 ? 'solid' : 'strong'
}

// ── Orchestrator (rollup entry point) ─────────────────────────────────────────────────
// Assembles the low-level ResilienceModelInput from a day's derived signals + the trailing
// persisted daily-index window, then runs the port. Keeps the rollup free of the model's
// scaling-param derivation and NaN conventions.

export interface DailyIndices {
  dailyStress: number
  dailyRestorativeTime: number
  dailySleepRecovery: number
}

export interface ResilienceDayInput {
  sleepStartMs: number[]
  sleepEndMs: number[]
  sleepScore: number | null         // 0-100 (computeSleepScore)
  hrvBalance: number | null         // 0-100 readiness-composite contributor; null → the model's
                                    // hrv-absent path (NOT a fabricated 50), matching design 4a
  recoveryIndex: number | null      // 0-100 contributor; provisional/null → today contributes no index
  restingHeartRate: number | null   // 0-100 contributor score (NOT raw bpm); null → no index
  stressSeries: { tMs: number; level: number }[]  // buildDaytimeStressSeries (level ∈ [−1,1])
  nightHrvBaselineMs: number | null                // scales the daytime-stress quantization
}

export interface ResilienceComputeResult {
  level: number | null              // 1.0-5.0 banded (null while < window_min_length valid days)
  granular: number | null           // continuous pre-band
  confidence: number | null         // validDays / window_length
  /** today's three daily indices — persist these to fill the rolling window even on days the
   *  level itself can't yet be produced. null when today contributes no index. */
  dailyIndices: DailyIndices | null
  /**
   * Minutes of daytime stress coverage, against `minDaytimeStressHours × 60` (Q-510).
   *
   * **`null` means NOT EVALUATED, and that distinction is the point.** When a contributor is
   * missing this function deliberately feeds the model an empty stress series, so a coverage of 0
   * would be an artefact of that gating rather than a fact about the day — and it would send a
   * later auditor after the coverage gate when the real cause was a missing contributor. A number
   * here is always a real measurement of the day's own series.
   */
  daytimeStressCoverageMin: number | null
}

const nul = (v: number): number | null => (Number.isNaN(v) ? null : v)

/**
 * Run the full model for one day. `priorIndices` is the trailing ≤13 days of persisted, non-null
 * daily indices (oldest→newest); today's indices are computed here and appended internally. Today
 * contributes a real index only when its sleep-score/recovery-index/RHR contributors and night-HRV
 * baseline are present AND the daytime stress series has enough coverage — otherwise today is NaN
 * (skipped from the window) but the level can still resolve off the prior window (design 4a/4b).
 */
export function computeResilienceForDay(today: ResilienceDayInput, priorIndices: DailyIndices[]): ResilienceComputeResult {
  const dailyStressList = priorIndices.map(p => p.dailyStress)
  const dailyRestorativeTimeList = priorIndices.map(p => p.dailyRestorativeTime)
  const dailySleepRecoveryList = priorIndices.map(p => p.dailySleepRecovery)

  // Whether today can contribute a real index. hrvBalance may legitimately be absent (the model has
  // a designed hrv-free path); the other three contributors have no such path, so a missing one
  // must not be fabricated — force today's index NaN by feeding an empty stress series.
  const contributorsOk =
    today.sleepScore != null && today.recoveryIndex != null && today.restingHeartRate != null &&
    today.nightHrvBaselineMs != null && today.nightHrvBaselineMs > 0
  const scaling = daytimeStressScalingParams(today.nightHrvBaselineMs ?? 50)

  const out = runStressResilience({
    sleepStartTimestampsMs: today.sleepStartMs,
    sleepEndTimestampsMs: today.sleepEndMs,
    sleepScore: today.sleepScore ?? 0,
    hrvBalance: today.hrvBalance ?? NaN,
    recoveryIndex: today.recoveryIndex ?? 0,
    restingHeartRate: today.restingHeartRate ?? 0,
    stressLim: scaling.stressLim,
    saturationStressDeviation: scaling.saturationStressDeviation,
    saturationRecoveryDeviation: scaling.saturationRecoveryDeviation,
    recoveryLim: scaling.recoveryLim,
    stress: contributorsOk ? today.stressSeries.map(p => p.level) : [],
    stressTimestampsMs: contributorsOk ? today.stressSeries.map(p => p.tMs) : [],
    dailyStressList,
    dailyRestorativeTimeList,
    dailySleepRecoveryList,
  })

  const dailyIndices = Number.isNaN(out.dailyStress) ? null : {
    dailyStress: out.dailyStress,
    dailyRestorativeTime: out.dailyRestorativeTime,
    dailySleepRecovery: out.dailySleepRecovery,
  }
  return {
    level: nul(out.resilienceLevel),
    granular: nul(out.granularResilienceLevel),
    confidence: nul(out.confidence),
    dailyIndices,
    daytimeStressCoverageMin: contributorsOk ? out.daytimeStressCoverageMin : null,
  }
}

export type { ResilienceConstants }
