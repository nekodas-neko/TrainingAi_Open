import { dateStrMidnightInTz, shiftDateStr } from '../date-utils'

export interface FinalGrace {
  /** How long after a day ends a stamp still counts as partial. Default 0: final once past the end. */
  graceMs?: number
  /** Within the grace, the least time between two re-scores of one day. Default 0. */
  minIntervalMs?: number
  /** The clock; defaults to now. */
  now?: Date
}

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
  grace: FinalGrace = {},
): string[] {
  const graceMs = grace.graceMs ?? 0
  const nowMs = (grace.now ?? new Date()).getTime()
  const minIntervalMs = grace.minIntervalMs ?? 0
  const stale: string[] = []
  for (let back = lookbackDays; back >= 1; back--) {
    const day = shiftDateStr(today, -back)
    const dayEnd = dateStrMidnightInTz(shiftDateStr(day, 1), tz)
    const stampedAt = stampedAtByDay.get(day) ?? null
    if (stampedAt == null) { stale.push(day); continue }
    // Final only once stamped `graceMs` after the day ended (late data may still be on its way). A
    // stamp inside the grace is redone, but not more often than `minIntervalMs`, so a busy morning
    // does not re-score the same day on every read.
    if (stampedAt.getTime() < dayEnd.getTime() + graceMs && nowMs - stampedAt.getTime() >= minIntervalMs) stale.push(day)
  }
  return stale
}
