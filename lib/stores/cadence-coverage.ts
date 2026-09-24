import { CADENCE_SERIES_BIN_SEC, type CadenceSummary } from '@trainingai/shared/health/cadence'

/**
 * RV-167 — `stepsEstimate` integrates only the cadence bins that exist, so a strap whose
 * accelerometer stream starts late stores a fraction of the real steps with nothing marking it.
 *
 * Measured in production: the 2026-09-04 treadmill walk has 34 bins, the first at tSec 1470 of an
 * 1,800-second walk, and stored **584 steps** where the other nine full-strap walks stored
 * 2,888–3,870. Its `cadence_spm` of 116.9 looked normal, because the average is taken over the bins
 * that exist. `body-metadata` then adds that short number on top of ring steps, so the day was
 * about 2,400 steps light.
 */

/**
 * Below this, the estimate is missing more than it has and is discarded rather than scaled.
 *
 * **Deliberately conservative.** Scaling the 19%-covered walk up to a full one would invent the
 * missing four fifths from an average taken over the fifth we have — the same shape as the phantom
 * walk duration BF-190 fixed, where a number nobody measured was written as if measured. Null means
 * "not known", which is what the column held before Q-230 started filling it and what
 * `body-metadata` already handles.
 *
 * Half is the floor because no plausible walk is half stationary, so it rejects a broken stream
 * with margin while leaving a walk with genuine pauses alone. It is a threshold, not a measurement:
 * the nine good walks' coverage was never recorded, so tightening it wants that data first.
 */
export const MIN_CADENCE_COVERAGE = 0.5

/**
 * The share of the activity the cadence series actually covers, or `null` when it cannot be judged
 * — no series, or a duration of zero. `null` is NOT "poor coverage": a caller must not discard on
 * it, or a walk whose duration is momentarily unknown would lose good steps.
 */
export function cadenceCoverage(cadence: CadenceSummary | null | undefined, durationSec: number): number | null {
  if (!cadence || cadence.series.length === 0 || durationSec <= 0) return null
  // Each bin stands for CADENCE_SERIES_BIN_SEC of readings, so bins × bin width is the covered span.
  // Capped at 1: the last bin can extend past the end when the walk stops mid-bin.
  return Math.min(1, (cadence.series.length * CADENCE_SERIES_BIN_SEC) / durationSec)
}

/**
 * `stepsEstimate`, or `null` when the series covers too little of the activity to stand for it.
 */
export function stepsEstimateIfCovered(
  cadence: CadenceSummary | null | undefined,
  durationSec: number,
): number | null {
  const steps = cadence?.stepsEstimate ?? null
  if (steps == null) return null
  const coverage = cadenceCoverage(cadence, durationSec)
  if (coverage != null && coverage < MIN_CADENCE_COVERAGE) return null
  return steps
}
