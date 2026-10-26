import { shiftDateStr } from '../date-utils'
import { staleFinishedDays } from './finished-day-recheck'

/** How many finished days back a read of today looks for a verdict still taken mid-day. */
export const TRAINING_STRESS_RECHECK_DAYS = 7

/**
 * Finished days whose training-load verdict was taken before the day ended (or never), oldest
 * first, within `TRAINING_STRESS_RECHECK_DAYS` of `today`.
 *
 * A verdict stamped after its day's end is final and never redone, which is what makes the
 * look-back finite. Only yesterday used to be checked (LA-170), so a day nobody opened the app
 * after stayed on its partial-day verdict for good (#2400).
 *
 * #3079: **except when Oura's MET for the day changes after the final verdict.** Under the Oura API
 * a day's MET can land hours after the day ends (the Oura app syncs late), so the first post-midnight
 * verdict could be taken without it. `metChangedAtByDay` says when each Oura day's stored row (with
 * its MET) last changed; any column counts, which can re-evaluate a day whose MET did not move, a
 * bounded and harmless extra. A day is re-evaluated once when that row changed after its verdict. The
 * re-evaluation stamps a later time, so it runs again only if the MET changes again. A day's minutes
 * read Oura's day and the day before (Oura's activity day starts at 4 a.m.), so both count.
 */
export function staleTrainingStressDays(
  today: string,
  tz: string,
  evaluatedAtByDay: ReadonlyMap<string, Date | null>,
  metChangedAtByDay: ReadonlyMap<string, Date> = new Map(),
): string[] {
  // A verdict never taken, or taken before its day ended, is stale (#2400)...
  const stale = new Set(staleFinishedDays(today, tz, evaluatedAtByDay, TRAINING_STRESS_RECHECK_DAYS))
  // ...and so is one taken after the day ended but before Oura's MET for it last changed (#3079).
  for (let back = TRAINING_STRESS_RECHECK_DAYS; back >= 1; back--) {
    const day = shiftDateStr(today, -back)
    const evaluatedAt = evaluatedAtByDay.get(day) ?? null
    if (evaluatedAt == null) continue
    const metChanged = [metChangedAtByDay.get(shiftDateStr(day, -1)), metChangedAtByDay.get(day)]
      .some(at => at != null && at > evaluatedAt)
    if (metChanged) stale.add(day)
  }
  return [...stale].sort()
}

/** The look-back's first day, including the Oura day before it that its MET reads. */
export function trainingStressMetLookbackFrom(today: string): string {
  return shiftDateStr(today, -(TRAINING_STRESS_RECHECK_DAYS + 1))
}
