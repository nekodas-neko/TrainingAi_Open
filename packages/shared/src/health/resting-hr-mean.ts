import { shiftDateStr } from '@trainingai/shared/date-utils'

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
 */
export function meanRestingHr(rows: readonly { restingHeartRate?: number | null }[]): number | null {
  let sum = 0
  let n = 0
  for (const r of rows) {
    if (r.restingHeartRate == null || !(r.restingHeartRate > 0)) continue
    sum += r.restingHeartRate
    n += 1
  }
  return n ? Math.round(sum / n) : null
}
