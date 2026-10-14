import { MIN_LOGGED_DAYS, loggedDaysRemaining } from './adaptive-tdee'

/**
 * The counter under "I've finished logging" (Q-387): how many marked days the maintenance
 * calibration has and how many it still needs. One implementation for the current app's card and
 * the native app's, so the two cannot count differently (#2898).
 *
 * `count` is the emphasised figure and `detail` the rest of the line, so each app can style the
 * number on its own. Null when the profile cannot produce an estimate at all: a "0 of 10" would be
 * a target the user cannot move by logging.
 *
 * `gapMessage` is the server's reason the estimate is still on the formula. It is shown once
 * enough days are marked but the calibration still declines (too sparse, too few weigh-ins), where
 * "0 more days to calibrate" would promise something marking cannot deliver.
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
  gapMessage: string | null = null,
): CalibrationProgress | null {
  if (daysLogged == null) return null
  const remaining = loggedDaysRemaining(daysLogged, minDays)
  const days = `${daysLogged === 1 ? 'day' : 'days'} marked`
  if (calibrated) {
    return { remaining, count: String(daysLogged), detail: `${days} · your maintenance is calibrated from them` }
  }
  if (remaining === 0) {
    return { remaining, count: String(daysLogged), detail: gapMessage ? `${days} · ${gapMessage}` : days }
  }
  return {
    remaining,
    count: `${daysLogged} of ${minDays}`,
    detail: `days marked · ${remaining} more ${remaining === 1 ? 'day' : 'days'} to calibrate your maintenance`,
  }
}
