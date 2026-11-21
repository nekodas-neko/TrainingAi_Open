// Recent-3-vs-older-baseline sleep trends. THE only implementation of this ratio —
// lib/ai-periodization/signals.ts and adapter.ts:getNextSession previously carried
// duplicate inline copies of the duration variant (One Formula, One Place).
import type { SleepSession } from '@trainingai/shared/types/body'
import { computeSleepScoreSeries } from '@trainingai/shared/health/sleep-score'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { nightsWithDuration } from '@trainingai/shared/health/partial-night'
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

/**
 * A trend ratio with the date of the newest value it read (#3718). The daily check suggests rest on
 * a trend only when that newest value is last night's: a ratio whose recent three nights end days ago
 * is not about this morning, the rule `nightTemp.nightDate === today` already applies to temperature.
 */
export interface TrendReading {
  ratio: number
  /** Local `YYYY-MM-DD` of the newest value in the recent-3 window (a sleep row's wake date). */
  newestDate: string
}

function ratioReading(newestFirstRows: { date: string; value: number }[]): TrendReading | null {
  const ratio = ratioTrend(newestFirstRows.map(r => r.value))
  return ratio == null ? null : { ratio, newestDate: newestFirstRows[0].date }
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
  return sleepDurationTrendReading(sessions, tz)?.ratio ?? null
}

/** {@link sleepDurationTrend} with the newest night it read. */
export function sleepDurationTrendReading(sessions: SleepSession[], tz: string = DEFAULT_TZ): TrendReading | null {
  // #2265: a night the owner marked partial has no hours to trend, so it is skipped, not read as short.
  return ratioReading(newestFirst(nightsWithDuration(nightSessions(sessions, tz))).map(s => ({ date: s.date, value: s.durationHours ?? 0 })))
}

/** Quality trend over our own 0–100 sleep score (efficiency/stages/latency/
 *  restfulness/timing). Unscorable nights are skipped before windowing, so one
 *  bad row never reads as a 0-quality night. */
export function sleepScoreTrend(sessions: SleepSession[], tz: string = DEFAULT_TZ): number | null {
  return sleepScoreTrendReading(sessions, tz)?.ratio ?? null
}

/** {@link sleepScoreTrend} with the newest scored night it read. */
export function sleepScoreTrendReading(sessions: SleepSession[], tz: string = DEFAULT_TZ): TrendReading | null {
  // Nights only — `computeSleepScore` has no minimum-duration guard, so a 20-minute nap fed
  // straight in scores ~5 and drags the trend (the F-1 bug class, in a caller the original fix
  // missed).
  const rows = computeSleepScoreSeries(nightSessions(sessions, tz), tz)
    .flatMap(r => r.result?.score != null ? [{ date: r.session.date, value: r.result.score }] : [])
  return ratioReading(rows)
}
