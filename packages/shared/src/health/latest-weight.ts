/**
 * The weight a day's goals are built from: the weigh-in with the latest `date` on or before
 * `onOrBefore` (#2926).
 *
 * **Picked by MAX DATE, never by array position.** Four readers used to take
 * `[...rows].reverse().find(weight > 0)`, which is "the latest" only when rows arrive oldest first.
 * Postgres `listBodyMetrics` returns them newest first, so in production that expression returned the
 * OLDEST weigh-in in the window, and `getDailyGoals` scaled the active-energy goal from a weight up
 * to four weeks old. The order a repository returns is not a contract a picker may lean on.
 *
 * A zero or negative weight is not a weigh-in and is skipped, as before. No weight in range returns
 * null, which `getDailyGoals` already handles with its default active-energy goal.
 *
 * Two rows on the same date: the FIRST one in the input wins (strict `>`). `body_metrics` is unique on
 * `(user_id, date)`, so one repository read cannot produce a tie; it can only happen in an array a
 * caller merged by hand. Strict `>` is also what `latestRestingHrRow` uses, so the two pickers over
 * the same rows break ties the same way.
 */
export function latestWeightKg(
  rows: readonly { date: string; weightKg?: number | null }[],
  onOrBefore: string,
): number | null {
  let best: { date: string; weightKg: number } | null = null
  for (const r of rows) {
    if (r.weightKg == null || !(r.weightKg > 0) || r.date > onOrBefore) continue
    if (best == null || r.date > best.date) best = { date: r.date, weightKg: r.weightKg }
  }
  return best?.weightKg ?? null
}
