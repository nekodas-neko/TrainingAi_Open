/**
 * #3075 stages 4 and 5: the Oura Cloud connector's mapping of a sleep period's recording detail into
 * the generic shapes of `@trainingai/shared/health/sleep-recording`. This is the only place that
 * knows what Oura's fields mean; scoring reads the generic shapes and never these names.
 *
 * - `movement_30_sec`: one character per 30-second epoch, '1' no motion, '2' restless, '3' tossing
 *   and turning, '4' active (Oura API v2, `SleepModel.movement_30_sec`). Mapped onto our 0-3 scale
 *   in order. Any other character is an epoch Oura did not classify, which is unmeasured, not still.
 *   The series starts at the period's `bedtime_start`, like the hypnogram.
 * - `low_battery_alert`: Oura's flag that the ring's battery ran low during the period, so its record
 *   of the night may stop short. Mapped to "recording incomplete".
 * - `sleep_algorithm_version`: the label of the sleep algorithm Oura ran ('v1', 'v2'). Mapped as is.
 */
import type { MovementLevel, MovementSeries } from '@trainingai/shared/health/sleep-recording'

/** Seconds per character of `movement_30_sec`. */
export const OURA_MOVEMENT_EPOCH_SEC = 30

const LEVEL_BY_CLASS: Record<string, MovementLevel> = { '1': 0, '2': 1, '3': 2, '4': 3 }

/** Oura's `movement_30_sec` as a generic movement series, or null with no string or start. */
export function ouraMovementSeries(
  movement30Sec: string | null | undefined,
  bedtimeStart: Date | string | null | undefined,
): MovementSeries | null {
  if (typeof movement30Sec !== 'string' || movement30Sec.length === 0 || bedtimeStart == null) return null
  if (!Number.isFinite(new Date(bedtimeStart).getTime())) return null
  return {
    epochSec: OURA_MOVEMENT_EPOCH_SEC,
    startAt: bedtimeStart,
    levels: Array.from(movement30Sec, ch => LEVEL_BY_CLASS[ch] ?? null),
  }
}

/** Oura's `low_battery_alert` as the generic "recording incomplete" flag. Only a true says so. */
export function ouraRecordingIncomplete(lowBatteryAlert: boolean | null | undefined): boolean {
  return lowBatteryAlert === true
}

/** Oura's `sleep_algorithm_version` as the generic algorithm version, or null when Oura sent none. */
export function ouraAlgorithmVersion(sleepAlgorithmVersion: string | null | undefined): string | null {
  return typeof sleepAlgorithmVersion === 'string' && sleepAlgorithmVersion.trim() !== '' ? sleepAlgorithmVersion.trim() : null
}
