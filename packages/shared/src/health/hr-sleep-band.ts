import { fromZonedTime } from 'date-fns-tz'
import { wallClockMinuteReader } from '../date-utils'

/** A sleep band expressed as minutes-of-day offsets on the 0..1440 chart x-axis. */
export interface HrSleepWindow {
  startMin: number
  endMin: number
}

/**
 * Convert a sleep session's bedtime interval into minute-of-day offsets for the
 * "Heart Rate · Today" chart, in the user's timezone, clipped to the displayed
 * day [0, 1440]. The anchor is the *actual UTC instant* of local midnight for
 * `dateStr` in `tz`, so an overnight sleep that started the previous evening
 * clips to 0 and a morning wake maps to its true minute — no `toISOString()`
 * slicing, no `now − N×86400000`. Minutes are on the clock face (`wallClockMinuteReader`), the same
 * axis as the heart-rate trace, so on a daylight-saving day the band sits where the trace does.
 *
 * Returns null when the interval, once clipped, has no visible span on `dateStr`
 * (e.g. a sleep that both started and ended before the displayed midnight).
 */
export function bedtimeToMinuteWindow(
  start: Date,
  end: Date,
  dateStr: string,
  tz: string,
): HrSleepWindow | null {
  const midnightMs = fromZonedTime(`${dateStr}T00:00:00`, tz).getTime()
  const minuteOf = wallClockMinuteReader(midnightMs, tz)
  const rawStart = minuteOf(start.getTime())
  const rawEnd = minuteOf(end.getTime())
  const startMin = Math.max(0, Math.min(1440, rawStart))
  const endMin = Math.max(0, Math.min(1440, rawEnd))
  if (endMin <= startMin) return null
  return { startMin, endMin }
}
