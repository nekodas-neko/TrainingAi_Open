/**
 * Turning a remembered bedtime into the instant to store (Q-519).
 *
 * **The calendar day is the whole difficulty.** A night dated `D` starts the *evening before* when
 * the bedtime is before midnight, and on `D` itself when it is after — so a 23:00 answer and an
 * 00:30 answer belong to different days for the same night. Getting that backwards writes a value
 * 24 hours out.
 *
 * The split is at noon, which is the same anchor `minutesFromNoon` uses for exactly this reason:
 * nobody's normal bedtime is midday, so it is the one hour of the clock a bedtime never lands on.
 *
 * **It does not currently change what the app computes**, and that is worth saying so nobody
 * "simplifies" it away: the only reader is `/api/user/bedtime-estimate`, which passes the value
 * through `minutesFromNoon` and so reads the clock time alone. The date matters for the row being
 * honest, and for the first display that ever shows it.
 */

import { aestMidnight } from '@trainingai/shared/date-utils'

/** Minutes past midnight from `HH:MM`, or null when it is not a clock time. */
export function parseClock(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** Noon: before it, the bedtime is on the night's own date; at or after, it is the evening before. */
const NOON_MINUTES = 720

/**
 * The instant a remembered bedtime of `clock` refers to, for the night dated `nightDate`.
 *
 * Returns null rather than a guess when either input is unusable — a bad clock string here would
 * otherwise become a real stored timestamp.
 */
export function bedtimeInstant(nightDate: string, clock: string, tz: string): string | null {
  const minutes = parseClock(clock)
  if (minutes == null) return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nightDate.replace(/\//g, '-'))
  if (!parts) return null
  const [y, m, d] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  // `Date.UTC` normalises the overflow, so the 1st of a month steps back to the last of the previous
  // one without any month-length arithmetic here — the class of bug that built `2026-06-31`.
  const dayOffset = minutes >= NOON_MINUTES ? -1 : 0
  const midnight = aestMidnight(y, m, d + dayOffset, tz)
  return new Date(midnight.getTime() + minutes * 60_000).toISOString()
}
