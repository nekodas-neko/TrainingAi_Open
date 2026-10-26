/**
 * One wake date's Sleep Score: the one implementation of "which nights a night is scored against".
 *
 * The readiness read (`lib/health/readiness-payload.ts`) and the re-score of a night Oura changed
 * (`lib/health/rescore-nights.ts`, #3079) both persist a Sleep Score. They used to build the window
 * separately (the read from its own today − 28, the re-score from the night's date − 28), so the
 * same night could score a point apart depending on which path wrote it last. Both call this now.
 *
 * The window is the sessions dated in the `SLEEP_SCORE_HISTORY_DAYS` days up to and including the
 * date, grouped into nights; the date's canonical night is scored against baselines of the nights
 * that ended before it ("prior" by the scored night's end, the day audit's rule, #2456).
 */
import { shiftDateStr } from '../date-utils'
import type { SleepSession } from '../types/body'
import { nightSessions, canonicalNightForDate } from './sleep-night'
import { computeSleepScore, sleepScoreBaselines } from './sleep-score'

/** Days of sessions before the scored date that its baselines are built from. */
export const SLEEP_SCORE_HISTORY_DAYS = 28

export function scoreSleepForDate(sessions: readonly SleepSession[], date: string, tz: string) {
  const from = shiftDateStr(date, -SLEEP_SCORE_HISTORY_DAYS)
  const nights = nightSessions(sessions.filter(s => s.date >= from && s.date <= date), tz)
  const night = canonicalNightForDate(nights, date, tz)
  if (!night) return null
  const result = computeSleepScore(night, tz, sleepScoreBaselines(
    nights.filter(n => n.sleepEnd.getTime() < night.sleepEnd.getTime()), tz, night,
  ))
  return result ? { night, result } : null
}
