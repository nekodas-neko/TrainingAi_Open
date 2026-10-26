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
 *
 * #3079: **a stamped day is also stale when Oura's MET for it changed after the stamp.** The Oura app
 * can sync a day or two late, so a value stamped without that MET is final by the clock and wrong.
 * `metChangedAtByDay` says when each Oura day's stored row last changed (`getOuraCloudMetChangedAt`);
 * a day's minutes read Oura's day and the day before (its activity day starts at 4 a.m.), so both
 * count. The re-score stamps a later time, so it runs again only if the MET changes again. Any
 * column of the row counts, a bounded and harmless over-trigger.
 */
export function staleFinishedDays(
  today: string,
  tz: string,
  stampedAtByDay: ReadonlyMap<string, Date | null>,
  lookbackDays: number,
  grace: FinalGrace = {},
  metChangedAtByDay: ReadonlyMap<string, Date> = new Map(),
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
    const metChanged = [metChangedAtByDay.get(shiftDateStr(day, -1)), metChangedAtByDay.get(day)]
      .some(at => at != null && at > stampedAt)
    if (metChanged) { stale.push(day); continue }
    // Final only once stamped `graceMs` after the day ended (late data may still be on its way). A
    // stamp inside the grace is redone, but not more often than `minIntervalMs`, so a busy morning
    // does not re-score the same day on every read.
    if (stampedAt.getTime() < dayEnd.getTime() + graceMs && nowMs - stampedAt.getTime() >= minIntervalMs) stale.push(day)
  }
  return stale
}

/** The first Oura day whose MET a `lookbackDays` look-back reads: its first day, and the day before it. */
export function metLookbackFrom(today: string, lookbackDays: number): string {
  return shiftDateStr(today, -(lookbackDays + 1))
}
