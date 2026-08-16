// Recent-3-vs-older-baseline sleep trends. THE only implementation of this ratio —
// lib/ai-periodization/signals.ts and adapter.ts:getNextSession previously carried
// duplicate inline copies of the duration variant (One Formula, One Place).
import type { SleepSession } from '@trainingai/shared/types/body'
import { computeSleepScoreSeries } from '@trainingai/shared/health/sleep-score'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

// Ratio of the newest-3 values to the mean of the next-up-to-7 older values.
// null when there aren't ≥4 values or the baseline is 0 — callers treat null
// as "no data, omit from reasoning".
function ratioTrend(newestFirstValues: number[]): number | null {
  if (newestFirstValues.length < 4) return null
  const recent3 = newestFirstValues.slice(0, 3)
  const older = newestFirstValues.slice(3, 10)
  const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length
  const olderAvg = older.reduce((s, v) => s + v, 0) / older.length
  return olderAvg > 0 ? recentAvg / olderAvg : null
}

function newestFirst(sessions: SleepSession[]): SleepSession[] {
  return [...sessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
}

/**
 * Duration-only trend (hours), over nights.
 *
 * Its sibling below was given the nap filter when F-1 was fixed and this one was not (Q-76), which
 * is the worse half of the miss: a 0.1 h evening bout enters the recent-3 window as a whole "night"
 * and drops the ratio by a third on its own — and this ratio is what tells the periodisation engine
 * and the next-session recommender that the user is under-slept.
 *
 * Rows with no duration are now dropped rather than counted as 0 hours, matching `sleepScoreTrend`'s
 * "skip the unscorable" rule. Zeroing them was legacy parity with the inline copies this module
 * replaced, and it manufactured exactly the deficit it was supposed to detect.
 */
export function sleepDurationTrend(sessions: SleepSession[], tz: string = DEFAULT_TZ): number | null {
  return ratioTrend(newestFirst(nightSessions(sessions, tz)).map(s => s.durationHours ?? 0))
}

/** Quality trend over our own 0–100 sleep score (efficiency/stages/latency/
 *  restfulness/timing). Unscorable nights are skipped before windowing, so one
 *  bad row never reads as a 0-quality night. */
export function sleepScoreTrend(sessions: SleepSession[], tz: string = DEFAULT_TZ): number | null {
  // Nights only — `computeSleepScore` has no minimum-duration guard, so a 20-minute nap fed
  // straight in scores ~5 and drags the trend (the F-1 bug class, in a caller the original fix
  // missed).
  const scores = computeSleepScoreSeries(nightSessions(sessions, tz), tz)
    .map(r => r.result?.score)
    .filter((v): v is number => v != null)
  return ratioTrend(scores)
}
