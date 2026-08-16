/**
 * Cadence (steps per minute) — the ONE place cadence is derived, for both sources.
 *
 * Two independent derivations feed it, and they are deliberately kept comparable so each
 * can validate the other (docs/gait-movement-domain.md's "one gait discriminator, one place"):
 *
 *   ring  — the 0x7e/0x7f gait windows already decoded by `steps_motion_decoder` carry
 *           `stride_frequency` directly, so ring cadence is a unit conversion, not DSP.
 *           ~30 s granularity, works all day, no extra battery cost.
 *   strap — the Polar H10 exposes NO cadence over BLE (polar-h10-ble skill §0), so strap
 *           cadence is our own DSP over the PMD accelerometer: band-limited autocorrelation
 *           of the acceleration magnitude. ~seconds granularity, run/walk only.
 *
 * Both end at `spm` through this module. `gaitBandAutocorr` in lib/oura-ble/gait-step-count.ts
 * now delegates to `bandAutocorrPeak` here so there is a single autocorrelation implementation.
 */

/** Which sensor a cadence reading came from. */
export type CadenceSource = 'ring' | 'strap'

// ---------------------------------------------------------------------------
// Shared primitive: band-limited autocorrelation peak
// ---------------------------------------------------------------------------

export interface BandPeak {
  /** Peak frequency in Hz, sub-sample interpolated. */
  hz: number
  /** Normalized autocorrelation at the peak (0..~1) — rhythm confidence. */
  strength: number
}

export interface BandPeakOptions {
  /** Sub-sample parabolic interpolation of the peak lag. Default true. */
  interpolate?: boolean
  /** Prefer a strong double-frequency peak over the winner. Default true. */
  octaveCorrect?: boolean
  /**
   * Round the lag-band edges instead of widening them with floor/ceil. Default false.
   * Exists only so the calibrated gait gate keeps its exact historical band.
   */
  roundLagBounds?: boolean
}

/**
 * Strongest normalized autocorrelation of a detrended window within [minHz, maxHz].
 *
 * Two refinements over a plain lag scan, both load-bearing for cadence accuracy and both
 * defaulted ON here but disabled by the gait gate (see `gaitBandAutocorr`):
 *
 * 1. **Parabolic interpolation** around the winning lag. Lag is an integer number of
 *    samples, so a raw scan quantizes badly at the rates we stream: at 50 Hz a 3 Hz rhythm
 *    sits at lag 16.7, and neighbouring integer lags 16/17 are 187.5 and 176.5 spm — an
 *    11 spm step, far coarser than the few-spm accuracy this metric needs. Interpolating the
 *    peak recovers sub-sample lag and with it sub-spm resolution.
 * 2. **Octave correction**. Torso acceleration during gait has energy at BOTH the step
 *    frequency and the stride frequency (every other footfall, from left/right asymmetry),
 *    and the stride peak is often the taller one — so a naive argmax reports half the true
 *    cadence. If a peak at double the frequency is nearly as strong, prefer it.
 */
export function bandAutocorrPeak(
  window: number[],
  sampleRate: number,
  minHz: number,
  maxHz: number,
  options: BandPeakOptions = {},
): BandPeak | null {
  const { interpolate = true, octaveCorrect = true, roundLagBounds = false } = options
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null
  if (!(maxHz > minHz) || minHz <= 0) return null
  const n = window.length
  if (n < 2) return null

  const lagMin = roundLagBounds
    ? Math.max(1, Math.round(sampleRate / maxHz))
    : Math.max(1, Math.floor(sampleRate / maxHz))
  const lagMax = roundLagBounds
    ? Math.min(n - 1, Math.round(sampleRate / minHz))
    : Math.min(n - 1, Math.ceil(sampleRate / minHz))
  if (lagMax < lagMin) return null

  const mean = window.reduce((a, b) => a + b, 0) / n
  const x = window.map(v => v - mean)
  const denom = x.reduce((a, b) => a + b * b, 0)
  if (!(denom > 0)) return null // flat window — no rhythm, not an error

  // Correlate one lag past each end so the winning lag always has both neighbours
  // available for the parabolic fit.
  const scanFrom = Math.max(1, lagMin - 1)
  const scanTo = Math.min(n - 1, lagMax + 1)
  const r = new Map<number, number>()
  const corr = (lag: number): number => {
    const cached = r.get(lag)
    if (cached !== undefined) return cached
    let acc = 0
    for (let i = 0; i + lag < n; i++) acc += x[i] * x[i + lag]
    const v = acc / denom
    r.set(lag, v)
    return v
  }

  let bestLag = 0
  let bestR = -Infinity
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const v = corr(lag)
    if (v > bestR) { bestR = v; bestLag = lag }
  }
  if (bestLag === 0 || bestR <= 0) return null

  // Boundary rejection. An argmax sitting exactly on a band edge means the correlation was
  // still rising as it left the search range — the real peak is OUTSIDE the band, and the
  // edge value is an artifact of where we stopped looking, not a measurement.
  //
  // This is not hypothetical: a walk whose sub-harmonic falls below the band pinned to the
  // floor and reported the same wrong number every window, which reads as a confident answer
  // rather than a missing one. Returning null lets the caller say "no cadence" honestly.
  if (bestLag === lagMin || bestLag === lagMax) return null

  // Octave correction: half the lag is double the frequency. Only considered when that
  // lag is still inside the searched band.
  const halfLag = Math.round(bestLag / 2)
  if (octaveCorrect && halfLag >= lagMin && halfLag !== bestLag) {
    const halfR = corr(halfLag)
    if (halfR >= OCTAVE_PREFER_RATIO * bestR) { bestLag = halfLag; bestR = halfR }
  }

  // Parabolic interpolation through (lag-1, lag, lag+1).
  let refinedLag = bestLag
  if (interpolate && bestLag - 1 >= scanFrom && bestLag + 1 <= scanTo) {
    const rm = corr(bestLag - 1)
    const r0 = bestR
    const rp = corr(bestLag + 1)
    const denomP = rm - 2 * r0 + rp
    if (denomP !== 0) {
      const delta = (0.5 * (rm - rp)) / denomP
      // A well-formed peak sits within half a sample of the sampled maximum; anything
      // beyond that means the fit is not describing a peak, so keep the integer lag.
      if (Math.abs(delta) <= 0.5) refinedLag = bestLag + delta
    }
  }
  if (!(refinedLag > 0)) return null

  return { hz: sampleRate / refinedLag, strength: bestR }
}

/**
 * A double-frequency peak this strong relative to the winner is taken to be the real step
 * rhythm, with the winner being the stride (half-cadence) harmonic. Deliberately below 1.0:
 * the stride peak usually IS taller, so requiring the step peak to win outright would never
 * correct anything. Tuned against the treadmill captures — see the admin cadence console.
 */
export const OCTAVE_PREFER_RATIO = 0.8

// ---------------------------------------------------------------------------
// Plausibility bounds (shared by both sources)
// ---------------------------------------------------------------------------

/** Slow walk. Below this a reading is treated as non-locomotor, not as a real cadence. */
export const MIN_PLAUSIBLE_SPM = 60
/** Faster than a sprint stride — beyond this the estimate is noise, not a person. */
export const MAX_PLAUSIBLE_SPM = 220

export function isPlausibleCadence(spm: number): boolean {
  return Number.isFinite(spm) && spm >= MIN_PLAUSIBLE_SPM && spm <= MAX_PLAUSIBLE_SPM
}

// ---------------------------------------------------------------------------
// Ring path — decoded stride_frequency → spm
// ---------------------------------------------------------------------------

/**
 * Steps-per-minute per unit of the decoder's `stride_frequency`.
 *
 * ✅ **×60 (steps/second) is the right reading** — `stride_frequency` is a step rate, so spm is
 * a ×60 unit conversion. The alternative was strides/second (×120), a clean factor of two apart.
 *
 * Settled by the metronome-referenced capture (2026-07-27, set 120 bpm): the ring's
 * capture-scoped windows read 1.952 Hz, which is ×60 = 117.1 spm against an independent strap
 * reading of 117.5. ×120 would be 234 — outside `MAX_PLAUSIBLE_SPM` and nowhere near the strap.
 *
 * What made this hard to see: the signal is octave-ambiguous (see `RING_CADENCE_VALIDATED`), so
 * a window that locks onto the stride instead of the step reads half — which looks exactly like
 * a ×120-vs-×60 units error but is not one. The units and the octave are separate questions;
 * conflating them is what sent two earlier revisions of this comment to the wrong conclusion.
 *
 * Do NOT hand-tune this away from 60. It is a unit conversion, and folding an accuracy bias
 * into it would hide the bias rather than fix it.
 */
export const RING_STRIDE_HZ_TO_SPM = 60

/**
 * Whether the ring's decoded `stride_frequency` may be used as a cadence source.
 *
 * ❌ **FALSE — but because the signal is OCTAVE-AMBIGUOUS, not because it is wrong.**
 *
 * An earlier revision of this comment said the ring "does not track cadence", citing a 64 spm
 * walk reading ~0.98 Hz and a 114 spm walk reading ~1.02 Hz — flat across a 1.8× change. A
 * metronome-referenced capture (2026-07-27, set 120 bpm) overturned that: the capture-scoped
 * windows were tight at 1.952 Hz → ×60 = 117.1 spm, against a strap reading of 117.5. Two
 * sensors sharing no hardware and no code agreeing to 0.4 spm is not a broken signal.
 *
 * Fitting all three counted captures against step rate and stride rate (half) shows which one
 * each window locked onto:
 *
 *     counted  64 spm → 0.98  Hz : step −8%  ✅ | stride +84%
 *     counted 114 spm → 1.02  Hz : step −46%    | stride  +7% ✅
 *     counted 120 spm → 1.952 Hz : step −2%  ✅ | stride +95%
 *
 * The first two captures landed on OPPOSITE SIDES of an octave split, which is precisely what
 * made the signal look flat when they were compared to each other. This is the same failure
 * mode `bandAutocorrPeak` already corrects for on the strap path.
 *
 * Still gated: one clean capture is not enough, and an uncorrected octave error ships a number
 * wrong by 2× — worse than showing none. The fix is now concrete (octave-correct the ring, then
 * re-validate across counted cadences) rather than a hunt for a decoding bug. The `unpack27`
 * column order remains a possible contributor but is NO LONGER the leading suspect: a wrong
 * column would not track cadence at all, and here it does.
 */
export const RING_CADENCE_VALIDATED = false

/** The two candidate readings of `stride_frequency`, for the calibration console. */
export const RING_STRIDE_INTERPRETATIONS: ReadonlyArray<{ label: string; factor: number }> = [
  { label: 'steps/s (×60)', factor: 60 },
  { label: 'strides/s (×120)', factor: 120 },
]

/**
 * Ring cadence from one decoded gait window. Returns null when the window carries no
 * plausible locomotor rhythm — callers treat null as "not walking/running right now",
 * never as zero.
 */
export function cadenceFromStrideHz(
  strideHz: number,
  factor: number = RING_STRIDE_HZ_TO_SPM,
): number | null {
  if (!Number.isFinite(strideHz) || strideHz <= 0) return null
  const spm = strideHz * factor
  return isPlausibleCadence(spm) ? spm : null
}

// ---------------------------------------------------------------------------
// Strap path — accelerometer DSP
// ---------------------------------------------------------------------------

/**
 * Cadence search band, in steps/second. Must sit STRICTLY OUTSIDE the plausibility bounds at
 * both ends (60–220 spm = 1.0–3.67 Hz), so that a reading is rejected by
 * `isPlausibleCadence` — a judgement about people — rather than by where the search happened
 * to stop.
 *
 * The original floor of 1.2 Hz (72 spm) sat ABOVE the 60 spm plausibility floor, which made a
 * genuinely slow cadence unreachable: instead of being rejected it pinned to the edge and was
 * reported as a confident 71.4 spm on a real 102 spm walk (owner capture 2026-07-27). Band
 * edges must never be reachable answers — see the boundary rejection in `bandAutocorrPeak`.
 */
export const CADENCE_MIN_HZ = 0.9
export const CADENCE_MAX_HZ = 3.9

/** Shortest window that can resolve a ~1.2 Hz rhythm with room for a few cycles. */
export const MIN_WINDOW_SEC = 3
/**
 * Rhythm-strength gate below which a window is not locomotion. Seeded from the ring's
 * proven gait gate (0.45 separates real walking from hand motion — gait-step-count.ts),
 * relaxed slightly because the chest is a noisier mounting point than the finger.
 */
export const CADENCE_STRENGTH_GATE = 0.4

export interface CadenceEstimate {
  cadenceSpm: number
  /** Normalized autocorrelation peak (0..~1). */
  strength: number
}

/**
 * Estimate cadence from a window of accelerometer MAGNITUDE samples.
 *
 * Magnitude (not a single axis) is used so the estimate does not depend on how the pod sits
 * on the chest strap. Returns null for a too-short window, an aperiodic one, or an
 * implausible rate — all of which mean "no cadence right now", not zero.
 */
export function detectCadence(magnitudes: number[], sampleRate: number): CadenceEstimate | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null
  if (magnitudes.length < MIN_WINDOW_SEC * sampleRate) return null

  const peak = bandAutocorrPeak(magnitudes, sampleRate, CADENCE_MIN_HZ, CADENCE_MAX_HZ)
  if (!peak || peak.strength < CADENCE_STRENGTH_GATE) return null

  const spm = peak.hz * 60
  if (!isPlausibleCadence(spm)) return null
  return { cadenceSpm: Math.round(spm * 10) / 10, strength: Number(peak.strength.toFixed(3)) }
}

// ---------------------------------------------------------------------------
// Accumulation over an activity
// ---------------------------------------------------------------------------

export interface CadenceReading {
  atMs: number
  spm: number
  source: CadenceSource
}

export interface CadenceSeriesPoint {
  tSec: number
  spm: number
}

export interface CadenceSummary {
  /** Mean cadence across locomotor readings, rounded to 1 dp. Null if none. */
  avgSpm: number | null
  /** Binned series for the detail-screen chart. */
  series: CadenceSeriesPoint[]
  /** The source that contributed the most readings, for provenance on the saved row. */
  source: CadenceSource | null
  readingCount: number
  /**
   * Estimated steps taken, integrated from the cadence readings. Null when none qualify.
   *
   * **Strap readings only, and gated per reading rather than per activity (Q-230).** Today that is
   * every reading — `pickLiveCadence` returns null on the ring branch while `RING_CADENCE_VALIDATED`
   * is false — so the filter is a no-op and `source === 'strap'` would have been an equally exact
   * gate. It stops being exact the day ring calibration ships: a single walk's readings could then
   * mix strap (while fresh) with ring (during strap gaps), at which point `source` means only
   * "contributed the most readings" and a per-activity gate would silently start counting ring data
   * into a step total. Filtering per reading now costs nothing and removes that day's surprise.
   */
  stepsEstimate: number | null
}

/**
 * Series resolution. A 45-minute run at one reading per second is 2,700 points; binning to
 * 10 s keeps the persisted jsonb small (~270 points) while staying finer than any chart the
 * detail screen draws.
 */
export const CADENCE_SERIES_BIN_SEC = 10

/**
 * Reduce an activity's cadence readings to what gets persisted.
 *
 * Only readings passing `isPlausibleCadence` contribute — pauses, stops and non-locomotor
 * stretches are absent from the series rather than being written as zeros, so the average is
 * cadence *while moving* (the convention every running platform uses) and a stop doesn't drag
 * it down. Bins carry the median, so a single mis-locked window can't move a bin.
 */
export function summarizeCadence(readings: CadenceReading[], startMs: number): CadenceSummary {
  const valid = readings.filter(r => isPlausibleCadence(r.spm) && Number.isFinite(r.atMs))
  if (valid.length === 0) return { avgSpm: null, series: [], source: null, readingCount: 0, stepsEstimate: null }

  // MEDIAN, not mean. The DSP occasionally mis-locks onto a harmonic and returns double the
  // true cadence — one 140.8 among readings clustered at ~64 dragged a mean to 73.6 (+9.6 vs
  // truth) while the median landed at 63.8 (−0.2). A single bad window should not move the
  // number a user sees, and a mean has no defence against one.
  const avgSpm = medianOf(valid.map(r => r.spm))

  const bins = new Map<number, number[]>()
  for (const r of valid) {
    const tSec = Math.max(0, Math.round((r.atMs - startMs) / 1000))
    const bin = Math.floor(tSec / CADENCE_SERIES_BIN_SEC) * CADENCE_SERIES_BIN_SEC
    const existing = bins.get(bin)
    if (existing) existing.push(r.spm)
    else bins.set(bin, [r.spm])
  }
  const series = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tSec, values]) => ({ tSec, spm: median(values) }))

  const counts = new Map<CadenceSource, number>()
  for (const r of valid) counts.set(r.source, (counts.get(r.source) ?? 0) + 1)
  let source: CadenceSource | null = null
  let bestCount = 0
  for (const [s, c] of counts) if (c > bestCount) { source = s; bestCount = c }

  return { avgSpm, series, source, readingCount: valid.length, stepsEstimate: estimateSteps(valid, startMs) }
}

/**
 * Steps, integrated from cadence: each populated bin contributes its median spm over the bin's
 * duration. Non-locomotor stretches are simply absent from the bins (the same convention that keeps
 * a stop from dragging the average down), so a walk with pauses counts only the moving parts.
 *
 * It is an ESTIMATE and the UI must say so. A bin with a single reading still counts a full
 * `CADENCE_SERIES_BIN_SEC`, which is the honest reading of "this is the cadence while moving during
 * that window" but does mean sparse data rounds up rather than down. Deriving a true gap-free count
 * needs the windowed raw-frame reader that does not exist yet — a different, larger job.
 */
function estimateSteps(valid: CadenceReading[], startMs: number): number | null {
  const strap = valid.filter(r => r.source === 'strap')
  if (strap.length === 0) return null
  const bins = new Map<number, number[]>()
  for (const r of strap) {
    const tSec = Math.max(0, Math.round((r.atMs - startMs) / 1000))
    const bin = Math.floor(tSec / CADENCE_SERIES_BIN_SEC) * CADENCE_SERIES_BIN_SEC
    const existing = bins.get(bin)
    if (existing) existing.push(r.spm)
    else bins.set(bin, [r.spm])
  }
  let steps = 0
  for (const values of bins.values()) steps += median(values) * (CADENCE_SERIES_BIN_SEC / 60)
  return Math.round(steps)
}

/** Median of a non-empty list, rounded to 1 dp. */
function medianOf(values: number[]): number {
  return median(values)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(m * 10) / 10
}

// ---------------------------------------------------------------------------
// Which activities have a cadence at all
// ---------------------------------------------------------------------------

/**
 * Activity types where "steps per minute" is the right quantity.
 *
 * Deliberately NOT keyed on `activity_types.is_distance_based`, which is the obvious-looking
 * choice and the wrong one in both directions: `treadmill` is not distance-based (no GPS
 * indoors) yet is pure foot cadence, while `cycle` and `swim` are distance-based but have no
 * step rate at all. Pedal cadence in particular sits at 60–100 rpm, partly inside the search
 * band, so a cyclist would be shown a confident, meaningless number.
 *
 * Unknown/custom types are excluded: showing no cadence is recoverable, showing a wrong one
 * teaches the user to distrust the metric.
 */
export const CADENCE_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'walk', 'run', 'hike', 'treadmill',
])

export function supportsCadence(activityType: string | null | undefined): boolean {
  return activityType != null && CADENCE_ACTIVITY_TYPES.has(activityType)
}

// ---------------------------------------------------------------------------
// Cross-validation — ring vs strap
// ---------------------------------------------------------------------------

/**
 * Two readings within this many spm are treated as agreeing. ~5% of a typical 170 spm
 * running cadence, and comfortably tighter than the factor-of-two error the ring's units
 * question would produce if `RING_STRIDE_HZ_TO_SPM` is wrong.
 */
export const CADENCE_AGREEMENT_SPM = 8

export interface CadenceAgreement {
  deltaSpm: number
  agree: boolean
  /** True when the two differ by ~2×, the signature of a units or octave error. */
  octaveMismatch: boolean
}

/**
 * Compare simultaneous ring and strap readings. `octaveMismatch` is the diagnostic that
 * matters most during calibration: it is exactly what a wrong `RING_STRIDE_HZ_TO_SPM`, or an
 * uncorrected stride-vs-step lock in the strap DSP, looks like.
 */
export function compareCadence(ringSpm: number, strapSpm: number): CadenceAgreement | null {
  if (!Number.isFinite(ringSpm) || !Number.isFinite(strapSpm)) return null
  if (ringSpm <= 0 || strapSpm <= 0) return null
  const deltaSpm = Math.round((ringSpm - strapSpm) * 10) / 10
  const ratio = ringSpm > strapSpm ? ringSpm / strapSpm : strapSpm / ringSpm
  return {
    deltaSpm,
    agree: Math.abs(deltaSpm) <= CADENCE_AGREEMENT_SPM,
    octaveMismatch: ratio >= 1.8 && ratio <= 2.2,
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** The three `activity_logs` cadence columns, as they should be written. */
export interface CadenceFields {
  cadenceSpm: number | null
  cadenceSeries: CadenceSeriesPoint[] | null
  cadenceSource: CadenceSource | null
}

/**
 * A summary reduced to what belongs in the row — the single place that decides what "no cadence"
 * looks like on disk.
 *
 * `summarizeCadence` returns `series: []` when nothing passed the plausibility gate, alongside a
 * null `avgSpm` and `source`. Persisting that empty array writes a **non-NULL** `jsonb` column, so
 * every `WHERE cadence_series IS NOT NULL` audit counts the row as having cadence data while its
 * scalar columns say it does not. All three of production's "rows with a cadence series" are this:
 * `jsonb_array_length = 0` (Q-47). Nothing measured means every cadence column is null.
 */
export function cadenceFieldsForSave(summary: CadenceSummary | null | undefined): CadenceFields {
  const series = summary?.series
  return {
    cadenceSpm: summary?.avgSpm ?? null,
    cadenceSeries: series && series.length > 0 ? series : null,
    cadenceSource: summary?.source ?? null,
  }
}
