/**
 * A day's Activity score is stored only once the day has ended (#2435, #3347), so the trends route
 * has `activityScore: null` for today. The Activity detail screen fills that one point with the live
 * score its hero is showing, so the trend ends on today rather than on a gap. One implementation so
 * the current app and Preview cannot disagree.
 *
 * Only today's point, and only when it has no stored value, is touched. Other days and other
 * fields come back unchanged.
 */
export function withLiveTodayActivity<T extends { date: string; activityScore: number | null }>(
  trends: readonly T[],
  today: string,
  liveScore: number | null | undefined,
): T[] {
  if (liveScore == null) return [...trends]
  return trends.map((t) => (t.date === today && t.activityScore == null ? { ...t, activityScore: liveScore } : t))
}
