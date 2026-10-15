/**
 * Finalise a finished day's Activity score (#2435).
 *
 * The readiness payload computes today's Activity score live, and used to store it on every read,
 * so a day's stored score was whatever it was the last time the app was opened. Today's value is
 * no longer stored. Once a day has ended it is scored here over the whole day and stamped
 * `finalisedAt`, the same pattern as the training-load re-check (#2400), with one difference: a day
 * is not final the moment it ends. Its evening heart rate and steps often arrive the next morning
 * (the ring drains on its next sync; Oura's cloud data lands when the Oura app syncs), so a stamp
 * counts as final only once it was written `ACTIVITY_FINAL_GRACE_HOURS` after the day ended.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { activityContributorsRow, type ActivityDay } from '@trainingai/shared/health/activity-day'
import { loadActivityDay, type LoadActivityDayOptions } from '@trainingai/shared/health/activity-day-load'
import type { FinalGrace } from '@trainingai/shared/health/finished-day-recheck'

/** How many finished days back a read of today looks for an Activity score that is not final. */
export const ACTIVITY_FINALISE_DAYS = 7

/**
 * How long after a day ends its score can still be redone. 24 h: the data this waits for is the
 * previous evening's, which lands by the next day's first sync of either source, and the cost of
 * waiting longer is only that a day's value can still move for one more day. A read inside the
 * grace uses the stored value and re-scores behind it.
 */
export const ACTIVITY_FINAL_GRACE_HOURS = 24

/** Within the grace, a day is re-scored at most this often, so a busy morning is not 12 queries a read. */
const ACTIVITY_RESCORE_MIN_INTERVAL_MS = 60 * 60_000

export function activityFinalGrace(now: Date = new Date()): FinalGrace {
  return { graceMs: ACTIVITY_FINAL_GRACE_HOURS * 3_600_000, minIntervalMs: ACTIVITY_RESCORE_MIN_INTERVAL_MS, now }
}

type ActivityRepo = Parameters<typeof loadActivityDay>[0] & Pick<WorkoutRepository, 'upsertOuraDailyDerived'>

/** Scores a finished day without storing it. Refuses a day that has not ended. */
export async function scoreFinishedActivityDay(
  repo: ActivityRepo,
  userId: string,
  tz: string,
  date: string,
  now: Date = new Date(),
  options?: LoadActivityDayOptions,
): Promise<ActivityDay> {
  const dayEnd = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
  if (now < dayEnd) throw new Error(`[activity-finalise] ${date} has not ended in ${tz}`)
  return loadActivityDay(repo, userId, tz, date, options)
}

/**
 * Stores a scored day, stamped `finalisedAt`. A day with nothing to score is stamped too, with no
 * score, so it is not scored again on every read until it leaves the look-back.
 */
export async function storeFinishedActivityDay(
  repo: Pick<WorkoutRepository, 'upsertOuraDailyDerived'>,
  userId: string,
  date: string,
  day: ActivityDay,
  now: Date = new Date(),
): Promise<void> {
  await repo.upsertOuraDailyDerived(userId, date, {
    activityScore: day.result?.score ?? null,
    activityContributors: activityContributorsRow(day, now.getTime()),
  })
}

/** Scores a finished day and stores it as final. Returns the scored day. */
export async function finaliseActivityDay(
  repo: ActivityRepo,
  userId: string,
  tz: string,
  date: string,
  now: Date = new Date(),
  options?: LoadActivityDayOptions,
): Promise<ActivityDay> {
  const day = await scoreFinishedActivityDay(repo, userId, tz, date, now, options)
  await storeFinishedActivityDay(repo, userId, date, day, now)
  return day
}
