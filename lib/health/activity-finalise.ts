/**
 * Finalise a finished day's Activity score (#2435).
 *
 * The readiness payload computes today's Activity score live, and used to store it on every read,
 * so a day's stored score was whatever it was the last time the app was opened. Today's value is
 * no longer stored. Once a day has ended it is scored here, once, over the whole day, and stamped
 * `finalisedAt` so it is never redone: the same pattern as the training-load re-check (#2400).
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { activityContributorsRow, type ActivityDay } from '@trainingai/shared/health/activity-day'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'

/** How many finished days back a read of today looks for an Activity score that is not final. */
export const ACTIVITY_FINALISE_DAYS = 7

type ActivityRepo = Parameters<typeof loadActivityDay>[0] & Pick<WorkoutRepository, 'upsertOuraDailyDerived'>

/**
 * Scores a finished day and stores it as final. Refuses a day that has not ended: storing a partial
 * value is the bug this exists to fix. Returns the scored day.
 */
export async function finaliseActivityDay(
  repo: ActivityRepo,
  userId: string,
  tz: string,
  date: string,
  now: Date = new Date(),
): Promise<ActivityDay> {
  const dayEnd = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
  if (now < dayEnd) throw new Error(`[activity-finalise] ${date} has not ended in ${tz}`)
  const day = await loadActivityDay(repo, userId, tz, date)
  // A day with nothing to score stores nothing, so it creates no row. It stays in the look-back and
  // is looked at again on the next read, which is cheap next to a row per empty day.
  if (day.result == null) return day
  await repo.upsertOuraDailyDerived(userId, date, {
    activityScore: day.result.score,
    activityContributors: activityContributorsRow(day, now.getTime()),
  })
  return day
}
