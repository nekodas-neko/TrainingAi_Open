/**
 * #3376: how a night's HRV (`body_metrics.hrv_ms`) was arrived at, for any source.
 *
 * A source can hand us a night two ways:
 * - `series_median`: the source sent the night's HRV series and we took the median of it, the
 *   ring-era definition (`hrvMsFromSamples`). Oura Cloud's 5-minute series is the first source to
 *   do this; a Fitbit or Health Connect adapter that receives a per-interval series would do the same.
 * - `source_average`: no usable series, so the night keeps the source's own nightly figure (Oura's
 *   `average_hrv`, a Fitbit daily RMSSD, a Health Connect daily value). Its definition is the
 *   source's, not ours.
 *
 * The night counts either way: a night with a gap costs readiness more than a different ruler does.
 * The mark exists so the two rulers stop mixing silently in a normal; whether a normal leaves the
 * averaged nights out is {@link hrvNightInNormal}, one line.
 *
 * Stored as per-field provenance in the row's existing `source_map`, keyed by method and holding the
 * source that wrote it (`{"hrv_ms:source_average": "oura_cloud"}`). A key counts only while that same
 * source still owns `hrv_ms`, so a later write from a higher-ranked source (a manual entry, the
 * ring) makes a stale mark inert without anyone having to remember to clear it.
 *
 * Pure and driver-free, like `source-rank`.
 */

export type NightHrvMethod = 'series_median' | 'source_average'

export const NIGHT_HRV_METHODS: readonly NightHrvMethod[] = ['series_median', 'source_average']

/** The `source_map` key that marks a night's HRV method. */
export function nightHrvMethodKey(method: NightHrvMethod): string {
  return `hrv_ms:${method}`
}

/**
 * The night's HRV and how it was reached: the series median when the source sent a usable series,
 * else the source's own nightly average, else nothing. Every source's connector goes through here,
 * so the fallback is one rule rather than one per device.
 */
export function chooseNightHrv(
  seriesMedianMs: number | null | undefined,
  sourceAverageMs: number | null | undefined,
): { hrvMs: number; method: NightHrvMethod } | null {
  if (seriesMedianMs != null && Number.isFinite(seriesMedianMs) && seriesMedianMs > 0) {
    return { hrvMs: seriesMedianMs, method: 'series_median' }
  }
  if (sourceAverageMs != null && Number.isFinite(sourceAverageMs) && sourceAverageMs > 0) {
    return { hrvMs: sourceAverageMs, method: 'source_average' }
  }
  return null
}

/**
 * Reads the mark back from a row's `source_map`. Undefined for a night nobody marked (the ring's
 * own rollup, manual entry, rows written before #3376), and for a mark whose source no longer owns
 * the field.
 */
export function nightHrvMethodFromProvenance(sourceMap: Record<string, string> | null | undefined): NightHrvMethod | undefined {
  const owner = sourceMap?.hrv_ms
  if (!owner) return undefined
  return NIGHT_HRV_METHODS.find(m => sourceMap![nightHrvMethodKey(m)] === owner)
}

/**
 * Whether a night's HRV joins a personal normal. Every night does today (owner, 3 Nov, #3376). To
 * leave source-reported averages out of the normal later, this becomes
 * `return method !== 'source_average'`; tonight's own value is still scored either way.
 */
export function hrvNightInNormal(_method: NightHrvMethod | undefined): boolean {
  return true
}
