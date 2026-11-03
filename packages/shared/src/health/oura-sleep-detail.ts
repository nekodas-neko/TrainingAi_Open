/**
 * #3075, stage 1: our own overnight HRV from the detail Oura sends with a sleep period.
 *
 * Oura's `average_hrv` is a per-night average whose definition is Oura's. Before 17 Oct the night's
 * HRV came from our own calculation on the ring's raw data: the MEDIAN of the night's gated rMSSD
 * samples, rounded to 0.1 (`hrvMsFromSamples`). Oura also sends the 5-minute HRV series the average
 * was taken from, so the same definition can be applied to it and the history stops having a seam.
 * Oura's own value stays stored on `sleep_sessions.average_hrv_ms`, beside ours in `body_metrics`.
 *
 * Reuses `hrvMsFromSamples`, so there is still one definition of "the night's HRV headline". The
 * ring-era MET-window exclusion and heart-rate plausibility gate have no input here: Oura's series
 * already carries a null for a 5-minute slot it did not measure, and a null is not a sample.
 *
 * Stage 2 adds the recovery-index hours from the 5-minute heart-rate series the same way.
 *
 * Pure, and importing no node module, like `night-vitals`.
 */
import { hrvMsFromSamples } from '@trainingai/shared/health/night-vitals'
import { computeRecoveryIndex } from '@trainingai/shared/health/recovery-index'

/** Oura's `PublicSample`: `items` taken every `interval` seconds from `timestamp`. */
export interface OuraSampleSeriesLike {
  interval: number
  items: readonly (number | null)[]
  timestamp?: string
}

/** Deciseconds in a second: the grid `TimedSample.ds` is in. */
const DS_PER_SECOND = 10

/**
 * The night's HRV in milliseconds from Oura's 5-minute HRV series: the median of its measured
 * (positive) samples, rounded to 0.1. Null when the series is missing or holds none, so the caller
 * can say Oura sent no detail rather than the night read as zero.
 */
export function overnightHrvFromSeries(series: OuraSampleSeriesLike | null | undefined): number | null {
  if (!series || !Array.isArray(series.items)) return null
  const step = (Number.isFinite(series.interval) && series.interval > 0 ? series.interval : 300) * DS_PER_SECOND
  const samples = series.items.flatMap((value, i) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? [{ ds: i * step, value }] : [])
  return hrvMsFromSamples(samples, [])
}

/**
 * #3075, stage 2: what makes a heart-rate series good enough to score the night's recovery index.
 *
 * The index is the hours from the night's lowest smoothed heart rate to waking, so it is only as
 * right as the claim "this was the night's lowest point". A series that holds a fragment of the
 * night (the ring came off, the battery died, Oura measured few slots) finds the minimum of the
 * fragment and states hours from it as if it were the night's. So a series is usable only when it
 * has BOTH:
 * - at least {@link RECOVERY_SERIES_MIN_SAMPLES} measured slots, one hour at 5 minutes. The ring-era
 *   function accepts 3, which only guards its 3-point smoothing window and says nothing about the night;
 * - measured slots covering at least {@link RECOVERY_SERIES_MIN_COVERAGE} of the period's slots
 *   (its length divided by the interval), so a long night with a short stretch of data is refused
 *   however many samples that stretch holds. Half is lenient on purpose: Oura leaves some slots
 *   null during movement, and a night is not refused for a few gaps.
 * A refused series is not zero hours: the caller keeps Oura's `recovery_index` contributor for the night.
 */
export const RECOVERY_SERIES_MIN_SAMPLES = 12
export const RECOVERY_SERIES_MIN_COVERAGE = 0.5

/**
 * The night's recovery-index hours from Oura's 5-minute heart-rate series and the period's own
 * window, through the ring-era `computeRecoveryIndex`: the ring fed it 5-minute average bpm bins
 * and the window's end as wake, and this feeds it Oura's 5-minute bpm slots and the period's end.
 * Null when the series is missing or not usable (see {@link RECOVERY_SERIES_MIN_SAMPLES}).
 */
export function overnightRecoveryIndexHoursFromSeries(
  series: OuraSampleSeriesLike | null | undefined,
  window: { sleepStart: Date; sleepEnd: Date },
): number | null {
  if (!series || !Array.isArray(series.items) || !series.timestamp) return null
  const startMs = new Date(series.timestamp).getTime()
  if (!Number.isFinite(startMs)) return null
  const intervalMs = (Number.isFinite(series.interval) && series.interval > 0 ? series.interval : 300) * 1000
  const hrSeries = series.items.flatMap((bpm, i) =>
    typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? [{ timestamp: new Date(startMs + i * intervalMs), bpm }] : [])
  const wake = window.sleepEnd.getTime()
  const slots = (wake - window.sleepStart.getTime()) / intervalMs
  if (!(slots > 0) || hrSeries.length < RECOVERY_SERIES_MIN_SAMPLES || hrSeries.length / slots < RECOVERY_SERIES_MIN_COVERAGE) return null
  return computeRecoveryIndex({ hrSeries, wakeTime: window.sleepEnd })?.hoursToSettle ?? null
}
