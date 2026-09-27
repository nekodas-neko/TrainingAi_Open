import type { WeeklyDigestMetrics } from "@trainingai/shared/health/weekly-digest-metrics";

/**
 * Did the recap week contain anything at all? (RV-211 ①)
 *
 * The digest TEXT cannot answer this: `buildWeeklyDigestText` always produces at least
 * "0 sessions, 0 kg total — first week of data" and "No personal records this week", so an account
 * with nothing in it still gets a banner reading *"Your week in review is ready"*. Ready to say
 * what, is the question that asks.
 *
 * **Only recap-week fields count, which rules out two that look tempting.** `weightChangeKg` is
 * "newest minus oldest across the fetched two-week window", so a non-null value can come entirely
 * from the PRIOR week; and `hrv.source` is chosen for the whole window for the same reason. Both
 * would report data for a week that had none. Every `WeekOverWeek.week` below is the recap week's
 * own value, which is what makes it usable here.
 *
 * Deliberately generous otherwise: one logged session, one PR, or a single night of sleep is a
 * week worth reading about. The banner is suppressed only when the week is genuinely empty.
 */
export function weekHasAnything(m: WeeklyDigestMetrics | null | undefined): boolean {
  if (!m) return false;
  return (
    m.training.sessions > 0 ||
    m.prs.length > 0 ||
    m.muscleSets.length > 0 ||
    m.hrv.week != null ||
    m.readiness.week != null ||
    m.sleepScore.week != null ||
    m.sleepHours.week != null ||
    m.stressHighMinutes.week != null ||
    m.resilience != null ||
    m.illness != null ||
    m.ots != null
  );
}
