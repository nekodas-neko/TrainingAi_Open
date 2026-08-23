/**
 * Daytime-stress engine — Oura `dhrv_imputation_1_1_0`.
 *
 * The ring measures HRV densely only during sleep; in the daytime it's sparse. This imputes a
 * daytime HRV value from a short window of skin-temperature, MET (activity) and heart-rate samples
 * plus personal baselines, then derives a stress signal `stress = dhrv − dhrv_baseline` (negative =
 * below your baseline = more stressed). Run per time-window across the day it yields a stress series.
 *
 * The Preprocessor (10-feature assembly) and scaling are ported verbatim from the model's source
 * (the vendor's `dhrv` model source (private archive)); the MLP runs via the golden-verified ONNX
 * (`runDhrvImputation`). Deterministic given its inputs. See the P3 plan doc.
 */
import type { DaytimeStressConstants } from '@/lib/oura-models/constants'
import { daytimeHrvEstimatesPerBucket, type DaytimeHrvModel } from '@trainingai/shared/health/daytime-hrv-model'

export interface DhrvBaselines {
  /** baseline daytime HRV (ms) — recent overnight HRV is a reasonable proxy at cold start */
  dhrvBaseline: number
  /** baseline (resting) HR (bpm) */
  hrBaseline: number
  /** baseline skin temperature (°C) */
  tempBaseline: number
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length
}
// Sample standard deviation (n−1), matching torch.std's default (unbiased).
function std(a: number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

/**
 * The model's `hr_min_max_median` — positional, not sorted-statistical (mirrors the source):
 * 1 sample → all three equal it; 2 → [v0, v0, v1]; 3+ → [v0, v1, v2]. Callers pass the HR window
 * already ordered as [min, median, max].
 */
function hrMinMedianMax(hr: number[]): { min: number; median: number; max: number } {
  if (hr.length === 1) return { min: hr[0], median: hr[0], max: hr[0] }
  if (hr.length === 2) return { min: hr[0], median: hr[0], max: hr[1] }
  return { min: hr[0], median: hr[1], max: hr[2] }
}

/** Assemble the 10 model features from the input windows + baselines (Preprocessor port). */
export function dhrvFeatures(temp: number[], met: number[], hr: number[], b: DhrvBaselines): number[] {
  const { min, median, max } = hrMinMedianMax(hr)
  return [
    median / b.hrBaseline,          // hr_median
    min / b.hrBaseline,             // hr_min
    max / b.hrBaseline,             // hr_max
    temp[temp.length - 1] / b.tempBaseline, // temp_skin (latest)
    std(temp),                      // temp_skin_std30
    mean(temp) / b.tempBaseline,    // temp_skin_avg30
    std(met.slice(-15)),            // met_std15
    mean(met),                      // met_avg60
    b.dhrvBaseline,                 // dhrv_baseline
    b.hrBaseline,                   // hr_baseline
  ]
}

export interface DaytimeStress {
  /** imputed daytime HRV (ms) */
  dhrv: number
  /** dhrv − baseline: negative = below baseline = more stressed */
  stress: number
}

// ── Oura's real daytime-stress rule (`stress_daytime_sensing_1_1_0`, ported verbatim) ──────────
// Maps intensity = dhrv − dhrv_baseline through night-HRV-baseline-dependent saturation curves to a
// scaled level in [−1, +1] (negative = below baseline = stressed). Pure formula, no inference.
// Same story as the scaling stats above — these four tables are the model's own, and were inline.
// The tables are INJECTED, not read from disk here (Q-545). Importing the loader put `node:fs` in
// this module's graph, and the Oura rollup imports this file — which is what kept a rollup that is
// otherwise runtime-agnostic from ever running in the WebView. Same mechanism `steps-motion-decoder`
// has used since Q-221: the server injects at boot, a client would inject from a route.
let daytimeConsts: DaytimeStressConstants | null = null

/** Provide the daytime-stress tables. Server: `ensureServerOuraConstants()`. */
export function setDaytimeStressConstants(c: DaytimeStressConstants): void {
  daytimeConsts = c
}

export function hasDaytimeStressConstants(): boolean {
  return daytimeConsts !== null
}

/** Test-only: forget the injected tables so a test can assert the unset behaviour. */
export function __clearDaytimeStressConstants(): void {
  daytimeConsts = null
}

// Throws rather than defaulting, deliberately — the same call the disk loader used to make. Every
// number below is a saturation bound from the vendor's own model; with no table this would emit
// plausible, wrong stress levels that flow into readiness and the body-battery chart.
const D_ = (): DaytimeStressConstants => {
  if (!daytimeConsts) {
    throw new Error(
      'daytime-stress: constants not set — call setDaytimeStressConstants() first ' +
        '(server: ensureServerOuraConstants() from lib/oura-models/constants/server-inject)',
    )
  }
  return daytimeConsts
}

function satLookup(limits: number[], vals: number[], x: number, dflt: number): number {
  for (let i = 0; i < limits.length; i++) if (x < limits[i]) return vals[i]
  return dflt
}

// equalize_scaled_levels: expand the inner ±SCALED_LEVEL_LIMIT band to ±TARGET_LEVEL_LIMIT (more
// sensitivity near 0). Applied to the scaled intensity AND the scaled thresholds in the .pt.
function equalizeScaledLevel(scaled: number): number {
  const { scaledLevelLimit: SCALED_LEVEL_LIMIT, targetLevelLimit: TARGET_LEVEL_LIMIT } = D_()
  if (Math.abs(scaled) <= SCALED_LEVEL_LIMIT) return scaled * (TARGET_LEVEL_LIMIT / SCALED_LEVEL_LIMIT)
  const k = TARGET_LEVEL_LIMIT / (1 - SCALED_LEVEL_LIMIT)
  return Math.sign(scaled) * (Math.abs(scaled) * k + (1 - k))
}

// neutral_zone_half_width(night_hrv_baseline) — the ±intensity band treated as neutral.
function neutralZoneHalfWidth(nightHrvBaseline: number): number {
  return nightHrvBaseline < 40 ? 2 : nightHrvBaseline < 75 ? 3 : 4
}

/**
 * Oura's daytime-stress level for one moment: dhrv vs its baseline, scaled by the person's night-HRV
 * baseline. Returns a value in [−1, +1] — negative = stressed, positive = recovered, 0 = at baseline.
 * Ported from the vendor's `stress_daytime_sensing_1_1_0` model source (private archive); golden-tested vs the `.pt`.
 */
export function daytimeStressLevel(dhrv: number, dhrvBaseline: number, nightHrvBaseline: number): number {
  const intensity = dhrv - dhrvBaseline
  const { stressSaturation: STRESS_SAT, recoverySaturation: REC_SAT } = D_()
  const stressSat = -satLookup(STRESS_SAT.limits, STRESS_SAT.values, nightHrvBaseline, 35) // negative
  const recSat = satLookup(REC_SAT.limits, REC_SAT.values, nightHrvBaseline, 46)          // positive
  let scaled: number
  if (intensity < stressSat) scaled = -1
  else if (intensity < 0) scaled = -intensity / stressSat // stressSat<0 → negative
  else if (intensity > recSat) scaled = 1
  else scaled = intensity / recSat
  return equalizeScaledLevel(scaled)
}

export interface StressScalingParams {
  /** equalized scaled stress threshold (negative, in [−1,0]) → resilience `stress_lim` */
  stressLim: number
  /** equalized scaled recovery threshold (positive, in [0,1]) → resilience `recovery_lim` */
  recoveryLim: number
  /** the scaled stress series is already clamped to [−1,+1] by the sensing model → ∓1 saturation */
  saturationStressDeviation: number
  saturationRecoveryDeviation: number
}

/**
 * The night-HRV-baseline-dependent scaling params the resilience preprocessor needs to quantize the
 * daytime-stress series. `stressLim`/`recoveryLim` are the sensing model's equalized stress/recovery
 * thresholds (`scale_output` in the sensing `.pt`); the stress series it consumes is the equalized
 * `scaled_intensity` (our `StressPoint.stressLevel`), already in [−1,+1], so the saturation clamps
 * are ∓1. Ported from `stress_daytime_sensing_1_1_0` `scale_output`.
 */
export function daytimeStressScalingParams(nightHrvBaseline: number): StressScalingParams {
  const nzhw = neutralZoneHalfWidth(nightHrvBaseline)                                   // intensity_recovery_threshold
  const { stressSaturation: STRESS_SAT, recoverySaturation: REC_SAT } = D_()
  const stressSat = -satLookup(STRESS_SAT.limits, STRESS_SAT.values, nightHrvBaseline, 35) // negative
  const recSat = satLookup(REC_SAT.limits, REC_SAT.values, nightHrvBaseline, 46)          // positive
  // scaled_stress_threshold = (−intensity_stress_threshold)/stress_sat = nzhw/stressSat (negative);
  // scaled_recovery_threshold = intensity_recovery_threshold/recovery_sat = nzhw/recSat (positive).
  return {
    stressLim: equalizeScaledLevel(nzhw / stressSat),
    recoveryLim: equalizeScaledLevel(nzhw / recSat),
    saturationStressDeviation: -1,
    saturationRecoveryDeviation: 1,
  }
}

export interface StressPoint {
  /** bucket midpoint (epoch ms) */
  t: number
  /** imputed daytime HRV for the bucket (ms) */
  dhrv: number
  /** Oura's daytime-stress level in [−1, +1] (negative = stressed), from `daytimeStressLevel` with
   *  the day's median dhrv as the self-calibrating baseline and the night-HRV baseline for scaling. */
  stressLevel: number
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Shared tail for both dhrv sources (ONNX and D5's own model): self-calibrating day-median
// baseline + Oura's real stress-level rule. The two per-bucket loops differ in HOW dhrv is
// derived; this scoring step is identical either way.
export function scoreStressPoints(raw: { t: number; dhrv: number }[], b: DhrvBaselines): StressPoint[] {
  if (raw.length === 0) return []
  const med = median(raw.map(r => r.dhrv))
  return raw.map(r => ({ t: r.t, dhrv: r.dhrv, stressLevel: daytimeStressLevel(r.dhrv, med, b.dhrvBaseline) }))
}

// ── Day-level aggregation (One Formula, One Place) ─────────────────────────────
// Bucket thresholds live in a dependency-free leaf (`daytime-stress-thresholds.ts`) so client
// bundles can import them without pulling this module's ONNX-backed dHRV imputation into the
// browser build; re-exported here so existing server-side importers are unaffected.
export {
  STRESS_BUCKET_MS,
  STRESS_HIGH_LEVEL,
  RECOVERY_HIGH_LEVEL,
  STRESS_HIGH_DAY_THRESHOLD_MIN,
} from '@trainingai/shared/health/daytime-stress-thresholds'
import { STRESS_BUCKET_MS, STRESS_HIGH_LEVEL, RECOVERY_HIGH_LEVEL } from '@trainingai/shared/health/daytime-stress-thresholds'

export interface StressDaySummary {
  /** day-mean scaled level, [−1,+1], 2dp (maps onto oura_daily_derived.daytime_stress_scaled) */
  daytimeStressScaled: number
  stressHighMinutes: number
  recoveryHighMinutes: number
}

/**
 * D5 — own daytime-HRV. Sibling of `buildDaytimeStressSeries` that scores each 30-min bucket with
 * this user's own fitted regression (`evaluateDaytimeHrvModel`) instead of Oura's ONNX imputation
 * — same bucketing + day-median + stress-level scoring tail (`scoreStressPoints`), different dhrv
 * source. A bucket needs HR, temp AND met data to be scored (met gates activity — see
 * `evaluateDaytimeHrvModel`); missing any of the three skips the bucket rather than guessing.
 * Synchronous (no ONNX inference) and infallible: returns [] when there isn't enough data.
 */
export function buildDaytimeStressSeriesFromModel(
  temp: { tsMs: number; valueC: number }[],
  met: { tsMs: number; value: number }[],
  hr: { tsMs: number; bpm: number }[],
  model: DaytimeHrvModel,
  b: DhrvBaselines,
  fromMs: number,
  toMs: number,
  bucketMs = STRESS_BUCKET_MS,
): StressPoint[] {
  if (hr.length === 0 || temp.length === 0 || met.length === 0) return []
  const raw = daytimeHrvEstimatesPerBucket(model, temp, met, hr, fromMs, toMs, bucketMs)
  return scoreStressPoints(raw, b)
}

/** Collapse an intraday stress series into the persisted day summary. null on empty —
 *  a day with no scored buckets writes nothing (COALESCE keeps any earlier value). */
export function summarizeStressDay(series: StressPoint[], bucketMs = STRESS_BUCKET_MS): StressDaySummary | null {
  if (series.length === 0) return null
  const bucketMin = bucketMs / 60_000
  const meanLevel = series.reduce((s, p) => s + p.stressLevel, 0) / series.length
  return {
    daytimeStressScaled: Math.round(meanLevel * 100) / 100,
    stressHighMinutes: Math.round(series.filter(p => p.stressLevel <= STRESS_HIGH_LEVEL).length * bucketMin),
    recoveryHighMinutes: Math.round(series.filter(p => p.stressLevel >= RECOVERY_HIGH_LEVEL).length * bucketMin),
  }
}
