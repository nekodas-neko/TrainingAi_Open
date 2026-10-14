import { MIN_LOGGED_DAYS } from './adaptive-tdee'

/**
 * The counter under "I've finished logging" (Q-387): how many marked days the maintenance
 * calibration has and how many it still needs. One implementation for the current app's card and
 * the native app's, so the two cannot count differently (#2898).
 *
 * `count` is the emphasised figure and `detail` the rest of the line, so each app can style the
 * number on its own. Null when the profile cannot produce an estimate at all: a "0 of 10" would be
 * a target the user cannot move by logging.
 */
export interface CalibrationProgress {
  remaining: number
  count: string
  detail: string
}

export function calibrationProgress(
  daysLogged: number | null,
  calibrated: boolean,
  minDays: number = MIN_LOGGED_DAYS,
): CalibrationProgress | null {
  if (daysLogged == null) return null
  const remaining = Math.max(0, minDays - daysLogged)
  if (calibrated) {
    return {
      remaining,
      count: String(daysLogged),
      detail: `${daysLogged === 1 ? 'day' : 'days'} marked · your maintenance is calibrated from them`,
    }
  }
  return {
    remaining,
    count: `${daysLogged} of ${minDays}`,
    detail: `days marked · ${remaining} more ${remaining === 1 ? 'day' : 'days'} to calibrate your maintenance`,
  }
}
