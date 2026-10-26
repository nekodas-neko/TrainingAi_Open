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
 * Pure, and importing no node module, like `night-vitals`.
 */
import { hrvMsFromSamples } from '@trainingai/shared/health/night-vitals'

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
