// #2495. Per-minute MET derived from the ring's raw accelerometer — the input cascade's rung 2
// (`accel_met`, "derived from the ring's motion"), for minutes the ring's own MET grid does not fill.
//
// **Not wired into the cascade, and it must not be until it is calibrated.** There is no default
// model here on purpose: `accelMetPoints` needs one passed in, and the only way to get one is
// `fitAccelMetModel` over minutes where the ring's own `device_met` exists. The calibration report
// (`accelMetCalibration`) states the error before any scorer reads a number from this.
//
// **Scale-free by construction.** The 0x33 stream's raw-count g-scale is unpinned upstream
// (`lib/oura-ble/accel.ts`), so nothing here assumes counts-per-g. Each chunk is normalised by its
// own gravity estimate — the median magnitude, which is ~1 g for a ring that is mostly not
// accelerating — and the per-minute intensity is the mean absolute deviation of that normalised
// magnitude (MAD, in g): the standard wrist-accelerometer activity measure, insensitive to the
// unknown scale and to orientation, because it works on the vector magnitude.
//
// Pure: no I/O, no clock. The caller passes chunks with wall-clock starts.

export interface AccelChunk {
  /** Wall clock of the first sample, epoch ms (`oura_accel_chunks.started_at`). */
  startedAtMs: number
  /** Samples per second (`sample_rate`; 50 on the owner's ring). */
  sampleRate: number
  /** √(x²+y²+z²) in raw counts, one per sample. */
  magnitudes: readonly number[]
}

export interface AccelMinute {
  /** The minute's start, epoch ms. */
  slot: number
  /** Mean absolute deviation of the gravity-normalised magnitude in that minute, in g. */
  intensity: number
  /** Samples that fell in the minute (coverage). */
  samples: number
}

const MINUTE_MS = 60_000

/** A minute counts only with at least this share of a full minute of samples: a minute the stream
 *  barely touched (a chunk edge, a re-arm gap) says little about the minute. */
export const ACCEL_MINUTE_MIN_COVERAGE = 0.5

/** A chunk shorter than this gives no stable gravity estimate and is skipped. */
export const ACCEL_CHUNK_MIN_SECONDS = 30

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Per-minute intensity across chunks. Samples are normalised by their OWN chunk's gravity before
 * minutes are formed, so a minute spanning two chunks mixes like with like.
 */
export function accelMinuteIntensity(chunks: readonly AccelChunk[]): AccelMinute[] {
  const byMinute = new Map<number, number[]>()
  let rate = 0
  for (const c of chunks) {
    if (!(c.sampleRate > 0) || c.magnitudes.length < c.sampleRate * ACCEL_CHUNK_MIN_SECONDS) continue
    const finite = c.magnitudes.filter(m => Number.isFinite(m) && m > 0)
    if (finite.length === 0) continue
    const gravity = median(finite)
    if (!(gravity > 0)) continue
    rate = Math.max(rate, c.sampleRate)
    const stepMs = 1000 / c.sampleRate
    c.magnitudes.forEach((m, i) => {
      if (!Number.isFinite(m) || m <= 0) return
      const t = c.startedAtMs + i * stepMs
      const slot = Math.floor(t / MINUTE_MS) * MINUTE_MS
      const arr = byMinute.get(slot) ?? []
      arr.push(m / gravity)
      byMinute.set(slot, arr)
    })
  }
  const out: AccelMinute[] = []
  for (const [slot, vals] of byMinute) {
    // Coverage against the fastest rate seen, so a minute is judged by the stream's own density.
    if (rate === 0 || vals.length < rate * 60 * ACCEL_MINUTE_MIN_COVERAGE) continue
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const mad = vals.reduce((s, v) => s + Math.abs(v - mean), 0) / vals.length
    out.push({ slot, intensity: mad, samples: vals.length })
  }
  return out.sort((a, b) => a.slot - b.slot)
}

/** `MET = max(1, intercept + slope × intensity)`: rest is 1 MET, and no motion reads below it. */
export interface AccelMetModel {
  intercept: number
  slope: number
}

export function accelMetFor(intensity: number, model: AccelMetModel): number {
  return Math.max(1, model.intercept + model.slope * intensity)
}

/** The derived MET as timestamped points, the shape `minuteMeanCandidates(points, 'accel_met', …)`
 *  takes. Requires a fitted model; there is no default. */
export function accelMetPoints(minutes: readonly AccelMinute[], model: AccelMetModel): { tsMs: number; value: number }[] {
  return minutes.map(m => ({ tsMs: m.slot, value: accelMetFor(m.intensity, model) }))
}

export interface CalibrationPair {
  slot: number
  intensity: number
  /** The ring's own MET for the same minute (`device_met`). */
  deviceMet: number
}

/** Pair derived minutes with the ring's MET grid by minute; minutes either side lacks are dropped. */
export function pairWithDeviceMet(
  minutes: readonly AccelMinute[], deviceMet: ReadonlyMap<number, number>,
): CalibrationPair[] {
  const out: CalibrationPair[] = []
  for (const m of minutes) {
    const d = deviceMet.get(m.slot)
    if (d != null && Number.isFinite(d)) out.push({ slot: m.slot, intensity: m.intensity, deviceMet: d })
  }
  return out
}

/** Ordinary least squares of `deviceMet` on `intensity`. Null with fewer than two distinct x. */
export function fitAccelMetModel(pairs: readonly CalibrationPair[]): AccelMetModel | null {
  const n = pairs.length
  if (n < 2) return null
  const mx = pairs.reduce((s, p) => s + p.intensity, 0) / n
  const my = pairs.reduce((s, p) => s + p.deviceMet, 0) / n
  let sxx = 0, sxy = 0
  for (const p of pairs) { sxx += (p.intensity - mx) ** 2; sxy += (p.intensity - mx) * (p.deviceMet - my) }
  if (!(sxx > 0)) return null
  const slope = sxy / sxx
  return { intercept: my - slope * mx, slope }
}

export interface ErrorSummary {
  n: number
  /** Mean absolute error, MET. */
  mae: number
  rmse: number
  /** Mean of (derived − device): positive reads high. */
  bias: number
  /** Pearson r between derived and device MET. Null when either side is constant. */
  r: number | null
}

function summarise(pred: readonly number[], truth: readonly number[]): ErrorSummary {
  const n = pred.length
  if (n === 0) return { n: 0, mae: NaN, rmse: NaN, bias: NaN, r: null }
  let ae = 0, se = 0, e = 0
  for (let i = 0; i < n; i++) { const d = pred[i] - truth[i]; ae += Math.abs(d); se += d * d; e += d }
  const mp = pred.reduce((s, v) => s + v, 0) / n
  const mt = truth.reduce((s, v) => s + v, 0) / n
  let cov = 0, vp = 0, vt = 0
  for (let i = 0; i < n; i++) { cov += (pred[i] - mp) * (truth[i] - mt); vp += (pred[i] - mp) ** 2; vt += (truth[i] - mt) ** 2 }
  return { n, mae: ae / n, rmse: Math.sqrt(se / n), bias: e / n, r: vp > 0 && vt > 0 ? cov / Math.sqrt(vp * vt) : null }
}

/** Device-MET bands the report breaks the error down by: rest, light, moderate, vigorous. */
export const CALIBRATION_BANDS: readonly { label: string; min: number; max: number }[] = [
  { label: '< 1.5 (rest)', min: -Infinity, max: 1.5 },
  { label: '1.5–3 (light)', min: 1.5, max: 3 },
  { label: '3–6 (moderate)', min: 3, max: 6 },
  { label: '≥ 6 (vigorous)', min: 6, max: Infinity },
]

export interface CalibrationReport {
  /** Fitted on every pair: the model a later wiring PR would ship. */
  model: AccelMetModel | null
  days: number
  /** Out-of-sample: each day predicted by a model fitted on the OTHER days, so the error is not
   *  flattered by the fit having seen the minutes it is scored on. */
  heldOut: ErrorSummary
  /** The same held-out error per device-MET band. */
  byBand: (ErrorSummary & { label: string })[]
  /** What predicting the mean device MET for every minute would score: the floor to beat. */
  baseline: ErrorSummary
}

/**
 * Leave-one-day-out calibration of the derivation against the ring's own MET. `dayOf` maps a minute
 * to its local day, so a day's minutes are never in their own training set.
 */
export function accelMetCalibration(
  pairs: readonly CalibrationPair[], dayOf: (slot: number) => string,
): CalibrationReport {
  const byDay = new Map<string, CalibrationPair[]>()
  for (const p of pairs) {
    const d = dayOf(p.slot)
    const list = byDay.get(d)
    if (list) list.push(p); else byDay.set(d, [p])
  }
  const pred: number[] = []
  const truth: number[] = []
  const bandOf: number[] = []
  for (const [day, held] of byDay) {
    const model = fitAccelMetModel(pairs.filter(p => dayOf(p.slot) !== day))
    if (!model) continue
    for (const p of held) {
      pred.push(accelMetFor(p.intensity, model))
      truth.push(p.deviceMet)
      bandOf.push(CALIBRATION_BANDS.findIndex(b => p.deviceMet >= b.min && p.deviceMet < b.max))
    }
  }
  const meanTruth = truth.length ? truth.reduce((s, v) => s + v, 0) / truth.length : NaN
  return {
    model: fitAccelMetModel(pairs),
    days: byDay.size,
    heldOut: summarise(pred, truth),
    byBand: CALIBRATION_BANDS.map((b, k) => {
      const idx = bandOf.map((x, i) => (x === k ? i : -1)).filter(i => i >= 0)
      return { label: b.label, ...summarise(idx.map(i => pred[i]), idx.map(i => truth[i])) }
    }),
    baseline: summarise(truth.map(() => meanTruth), truth),
  }
}
