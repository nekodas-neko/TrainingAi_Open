import { dateStrMidnightInTz, shiftDateStr } from '../date-utils'

/**
 * Finished days, oldest first, within `lookbackDays` of `today`, whose stored value was stamped
 * before the day ended (or never stamped).
 *
 * A value stamped after its day's end is final and never redone, which is what makes a look-back
 * finite. Shared by the training-load re-check (#2400) and the Activity score's finalise (#2435):
 * both store a value for a day while the day is still happening, and both have to tell that partial
 * value from a final one.
 */
export function staleFinishedDays(
  today: string,
  tz: string,
  stampedAtByDay: ReadonlyMap<string, Date | null>,
  lookbackDays: number,
): string[] {
  const stale: string[] = []
  for (let back = lookbackDays; back >= 1; back--) {
    const day = shiftDateStr(today, -back)
    const dayEnd = dateStrMidnightInTz(shiftDateStr(day, 1), tz)
    const stampedAt = stampedAtByDay.get(day) ?? null
    if (stampedAt == null || stampedAt < dayEnd) stale.push(day)
  }
  return stale
}
