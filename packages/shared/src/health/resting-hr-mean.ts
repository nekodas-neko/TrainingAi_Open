import { shiftDateStr } from '@trainingai/shared/date-utils'
import { perDeviceNormal, normalOrCarriedOver } from '@trainingai/shared/health/per-device-normal'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

/** The fixed trailing window the resting-HR mean is taken over, in days before today. */
export const RESTING_HR_WINDOW_DAYS = 28

/**
 * The resting-HR window ending today, as inclusive date strings: `[today − 28, today]`.
 *
 * Shifted on the date string, not `midnight − N×86400000`, which lands a day off around a clock
 * change in a daylight-saving zone (#3220). Fixed, never the caller's range: a window that moved
 * with the caller would move every zone boundary with it (review J-2).
 */
export function restingHrWindow(todayIso: string): { from: string; to: string } {
  return { from: shiftDateStr(todayIso, -RESTING_HR_WINDOW_DAYS), to: todayIso }
}

/**
 * The rounded mean of the measured resting-HR readings in a set of body-metric rows, or null when
 * none qualifies. A zero or negative value is no reading, the same as null.
 *
 * **The one resting-HR mean.** `resolveHrProfile` builds the zone-minute boundaries from it, and
 * the running plan's snapshot (#3216, the owner's option A) builds its HR zones and run targets
 * from it, so the zones a run is prescribed in and the zones its minutes are counted in agree. A
 * mean doesn't depend on row order, and one odd night moves it by only its share.
 *
 * **Per device (#3001).** Oura reads resting HR as its lowest 30-second sample, the ring as its
 * lowest 5-minute bin, so a mean pooled across the switch is neither device's. The mean is of the
 * device that measured the newest night (a row's `restingHeartRateSource`). Until that device has
 * `BASELINE_MIN_NIGHTS` readings the zones stay on the previous device's mean rather than jump at the
 * switch, which is the ring's for about 14 Oura nights; a user with only one device, or rows that
 * name none, gets the plain mean as before.
 */
export function meanRestingHr(
  rows: readonly { date?: string; restingHeartRate?: number | null; restingHeartRateSource?: string | null }[],
): number | null {
  const readings = rows.map((r, i) => ({
    // A row with no date keeps its place in the list, so a caller without dates reads as one device.
    date: r.date ?? String(i).padStart(6, '0'),
    value: r.restingHeartRate != null && r.restingHeartRate > 0 ? r.restingHeartRate : null,
    source: r.restingHeartRateSource,
  }))
  const mean = normalOrCarriedOver(perDeviceNormal(readings, { minNights: BASELINE_MIN_NIGHTS }))
  return mean == null ? null : Math.round(mean)
}
