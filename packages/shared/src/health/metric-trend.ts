// Confidence-weighted linear trend over a metric time series — ported from Oura's
// `atlas_trendline_1_0_0` (0-param, weighted least squares). Generic: the caller supplies the
// metric's coefficient of variation (`cv`); Oura's per-metric CVs live in the atlas_trendline
// source, not the vendored JSON attributes. Used for the body-composition trend line and reusable
// for any of our own metric trends.
//
// weights = conf^1.5 / sigma², sigma = clamp(|y|·cv, 1e-6); slope via weighted LS;
// slope_se = sqrt(1/ss_xx) (atlas_trendline's own SE definition, not textbook OLS);
// z = |slope|/slope_se; significance = 1 − exp(−z²/2). CI at z=1.282 (~80%, as in the model).

const Z_80 = 1.282

export interface WeightedTrend {
  /** Slope in metric-units per day. */
  slope: number
  slopeCiLow: number
  slopeCiHigh: number
  /** Fitted value at the first / last day. */
  startValue: number
  endValue: number
  /** endValue − startValue (fitted). */
  totalChange: number
  /** 0–1; 1 − exp(−z²/2). */
  significance: number
  nPoints: number
  valid: boolean
}

const INVALID: WeightedTrend = {
  slope: 0, slopeCiLow: 0, slopeCiHigh: 0, startValue: 0, endValue: 0,
  totalChange: 0, significance: 0, nPoints: 0, valid: false,
}

/**
 * Fit a confidence-weighted linear trend. `days`, `values`, `confidences` are equal-length; NaN
 * rows are dropped. `cv` is the metric's coefficient of variation (>0). Returns `valid:false`
 * (never throws) when there aren't enough points, the day-span is too short, or there's no
 * variance in x (matches the model's guard behaviour).
 */
export function weightedTrend(
  days: number[],
  values: number[],
  confidences: number[],
  cv: number,
  opts: { minPoints?: number; minSpanDays?: number } = {},
): WeightedTrend {
  const minPoints = opts.minPoints ?? 3
  const minSpanDays = opts.minSpanDays ?? 0
  const n = Math.min(days.length, values.length, confidences.length)
  if (!(cv > 0)) return INVALID

  const xs: number[] = []
  const ys: number[] = []
  const ws: number[] = []
  for (let i = 0; i < n; i++) {
    const x = days[i], y = values[i], c = confidences[i]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(c)) continue
    const conf = Math.min(1, Math.max(0, c))
    const sigma = Math.max(Math.abs(y) * cv, 1e-6)
    const w = Math.pow(conf, 1.5) / (sigma * sigma)
    if (!(w > 0)) continue
    xs.push(x); ys.push(y); ws.push(w)
  }

  const m = xs.length
  if (m < minPoints) return { ...INVALID, nPoints: m }
  const span = Math.max(...xs) - Math.min(...xs)
  if (span < minSpanDays) return { ...INVALID, nPoints: m }

  const wSum = ws.reduce((a, b) => a + b, 0)
  if (!(wSum > 0)) return { ...INVALID, nPoints: m }
  const xBar = xs.reduce((a, x, i) => a + ws[i] * x, 0) / wSum
  const yBar = ys.reduce((a, y, i) => a + ws[i] * y, 0) / wSum

  let ssxx = 0, ssxy = 0
  for (let i = 0; i < m; i++) {
    const dx = xs[i] - xBar
    ssxx += ws[i] * dx * dx
    ssxy += ws[i] * dx * (ys[i] - yBar)
  }
  if (!(ssxx > 0)) return { ...INVALID, nPoints: m }

  const slope = ssxy / ssxx
  const intercept = yBar - slope * xBar
  const slopeSe = Math.sqrt(1 / ssxx)
  const z = Math.abs(slope) / slopeSe
  const significance = 1 - Math.exp(-(z * z) / 2)

  const minDay = Math.min(...xs)
  const maxDay = Math.max(...xs)
  const startValue = intercept + slope * minDay
  const endValue = intercept + slope * maxDay

  return {
    slope,
    slopeCiLow: slope - Z_80 * slopeSe,
    slopeCiHigh: slope + Z_80 * slopeSe,
    startValue,
    endValue,
    totalChange: endValue - startValue,
    significance,
    nPoints: m,
    valid: true,
  }
}
