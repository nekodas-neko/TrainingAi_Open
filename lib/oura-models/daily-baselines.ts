// daily_short_term_baselines_1_1_0 — a faithful TypeScript port of the 0-parameter algorithmic
// TorchScript model (StressBaselines). Given a trailing window (5–21 days) of daily medians, it
// produces the personal short-term baselines the stress/illness/readiness pipeline compares against:
// Gaussian-weighted averages of the dHRV / skin-temp / HR-min medians, plus a filtered-median
// night-HRV baseline. Pinned to the captured .pt golden vector
// (lib/oura-models/onnx/__fixtures__/daily_short_term_baselines_1_1_0.golden.json, < 1e-3).
// Ported from the vendor's `daily_short_term_baselines_1_1_0` model source (private archive). Do NOT re-derive
// the constants or "improve" the algorithm — the golden is the source of truth. Infallible: invalid
// input yields NaN baselines (the model's default_error_value), never throws.

const MIN_OBS = 5
const MAX_OBS = 21

export interface DailyBaselinesInput {
  dhrvMedians: number[]
  skinTempMedians: number[]
  hrMinMedians: number[]
  totalSleepDurations: number[]   // seconds
  lowestHeartRates: number[]
  highestTemperatures: number[]   // °C
  averageHrvs: number[]           // ms
}

export interface DailyBaselines {
  dhrvBaseline: number
  skinTempBaseline: number
  hrMinBaseline: number
  nightHrvBaseline: number
}

// gaussian_weights(N): std = N/2.5; range = arange(N) − (N−1)/2; w = exp(−range² / (2·std²)).
function gaussianWeights(n: number): number[] {
  const std = n / 2.5
  const centre = (n - 1) / 2
  const w: number[] = []
  for (let i = 0; i < n; i++) {
    const x = i - centre
    w.push(Math.exp(-(x * x) / (2 * std * std)))
  }
  return w
}

function gaussianWeightedAverage(medians: number[]): number {
  if (medians.length === 0) return NaN
  const w = gaussianWeights(medians.length)
  let num = 0, den = 0
  for (let i = 0; i < medians.length; i++) { num += medians[i] * w[i]; den += w[i] }
  return num / den
}

// torch.median semantics: for an even-length tensor it returns the LOWER of the two middle values
// (element at index floor((n−1)/2) of the sorted array), NOT the average. The golden's night-HRV
// baseline (46.923 over 14 symmetric values) pins this.
function torchMedian(values: number[]): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

function calcNightHrvBaseline(i: DailyBaselinesInput): number {
  const n = Math.min(
    i.totalSleepDurations.length, i.lowestHeartRates.length,
    i.highestTemperatures.length, i.averageHrvs.length,
  )
  const filtered: number[] = []
  for (let k = 0; k < n; k++) {
    if (
      i.totalSleepDurations[k] >= 14400 &&
      i.lowestHeartRates[k] >= 30 && i.lowestHeartRates[k] <= 200 &&
      i.highestTemperatures[k] >= 28 && i.highestTemperatures[k] <= 40 &&
      i.averageHrvs[k] >= 5 && i.averageHrvs[k] <= 150
    ) filtered.push(i.averageHrvs[k])
  }
  return torchMedian(filtered)
}

const NAN_BASELINES: DailyBaselines = { dhrvBaseline: NaN, skinTempBaseline: NaN, hrMinBaseline: NaN, nightHrvBaseline: NaN }

/** Run the daily short-term baselines model. Returns NaN baselines (never throws) when a required
 *  median array is empty or outside the 5–21 observation window (the model's raise conditions). */
export function runDailyShortTermBaselines(i: DailyBaselinesInput): DailyBaselines {
  const inRange = (a: number[]) => a.length >= MIN_OBS && a.length <= MAX_OBS
  if (!inRange(i.dhrvMedians) || !inRange(i.skinTempMedians) || !inRange(i.hrMinMedians)) return NAN_BASELINES

  const dhrvBaseline = gaussianWeightedAverage(i.dhrvMedians)
  const skinTempBaseline = gaussianWeightedAverage(i.skinTempMedians)
  const hrMinBaseline = gaussianWeightedAverage(i.hrMinMedians)
  if (Number.isNaN(dhrvBaseline) || Number.isNaN(skinTempBaseline) || Number.isNaN(hrMinBaseline)) return NAN_BASELINES

  return { dhrvBaseline, skinTempBaseline, hrMinBaseline, nightHrvBaseline: calcNightHrvBaseline(i) }
}
