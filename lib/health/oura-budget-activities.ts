import type { WorkoutRepository } from '@/lib/data/repository'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { ouraWorkoutActivities, type CountedMovement, type OuraBudgetActivity } from '@trainingai/shared/health/oura-workout-activities'
import { budgetActivityLogs, HEALTH_CONNECT_SOURCE } from '@trainingai/shared/health/health-connect-workouts'
import type { ActivityLog } from '@trainingai/shared/types/body'

/**
 * Oura's own workouts on `[from, to]` as energy-budget activities, minus what the caller already
 * counts (#3087; the rules are `ouraWorkoutActivities`). The read is widened a day each side because
 * Oura files a workout under its own day while the budget keys it by the local day of its start.
 * A failed read costs the Oura workouts, never the budget: it degrades to what was counted before.
 *
 * The logs of the evening before `from` join the overlap check: a 23:30-00:30 log is dated the day
 * it started, outside the caller's range, yet its Oura copy starts after midnight and lands inside
 * it. Read only when there are workouts to check, unless the caller already has them
 * (`eveningBefore`); a log in it is never costed here, only matched.
 */
export async function ouraBudgetActivities(
  repo: Pick<WorkoutRepository, 'getOuraWorkouts' | 'listActivityLogs'>,
  userId: string,
  from: string,
  to: string,
  tz: string,
  counted: CountedMovement,
  eveningBefore?: CountedMovement['activityLogs'],
): Promise<OuraBudgetActivity[]> {
  let rows: Awaited<ReturnType<WorkoutRepository['getOuraWorkouts']>>
  try {
    rows = await repo.getOuraWorkouts(userId, { from: shiftDateStr(from, -1), to: shiftDateStr(to, 1) })
  } catch {
    return []
  }
  if (rows.length === 0) return []
  const earlier = eveningBefore ?? await readEveningBefore(repo, userId, from)
  const withEveningBefore = { ...counted, activityLogs: [...earlier, ...counted.activityLogs] }
  return ouraWorkoutActivities(rows, withEveningBefore, tz).filter(a => a.date >= from && a.date <= to)
}

async function readEveningBefore(repo: Pick<WorkoutRepository, 'listActivityLogs'>, userId: string, from: string) {
  const dayBefore = shiftDateStr(from, -1)
  try {
    return await repo.listActivityLogs(userId, dayBefore, dayBefore)
  } catch {
    // Without them only a midnight-crossing log on the range's first night goes unmatched.
    return []
  }
}

/**
 * Everything the energy budget costs on `[from, to]` beside strength sessions: the logged
 * activities less a Health Connect copy of an in-app workout (`budgetActivityLogs`, #3044), and
 * Oura's own workouts that none of those logs already counts. The Oura check runs on the filtered
 * logs, so a dropped copy cannot also keep out an Oura workout.
 */
export async function budgetMovement<T extends ActivityLog>(
  repo: Pick<WorkoutRepository, 'getOuraWorkouts' | 'listActivityLogs'>,
  userId: string,
  from: string,
  to: string,
  tz: string,
  counted: { activityLogs: readonly T[]; sessions: CountedMovement['sessions'] },
): Promise<{ logs: T[]; oura: OuraBudgetActivity[] }> {
  // The evening before matters to the Health Connect check only when there is a copy to check.
  const eveningBefore = counted.activityLogs.some(l => l.externalSource === HEALTH_CONNECT_SOURCE)
    ? await readEveningBefore(repo, userId, from)
    : undefined
  const logs = budgetActivityLogs(counted.activityLogs, counted.sessions, tz, eveningBefore)
  const oura = await ouraBudgetActivities(repo, userId, from, to, tz, { activityLogs: logs, sessions: counted.sessions }, eveningBefore)
  return { logs, oura }
}
