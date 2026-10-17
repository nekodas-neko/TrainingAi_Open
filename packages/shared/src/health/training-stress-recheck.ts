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
 */
export function staleTrainingStressDays(
  today: string,
  tz: string,
  evaluatedAtByDay: ReadonlyMap<string, Date | null>,
): string[] {
  return staleFinishedDays(today, tz, evaluatedAtByDay, TRAINING_STRESS_RECHECK_DAYS)
}
