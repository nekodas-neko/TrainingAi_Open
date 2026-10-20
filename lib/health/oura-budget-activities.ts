import type { WorkoutRepository } from '@/lib/data/repository'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { ouraWorkoutActivities, type CountedMovement, type OuraBudgetActivity } from '@trainingai/shared/health/oura-workout-activities'

/**
 * Oura's own workouts on `[from, to]` as energy-budget activities, minus what the caller already
 * counts (#3087; the rules are `ouraWorkoutActivities`). The read is widened a day each side because
 * Oura files a workout under its own day while the budget keys it by the local day of its start.
 * A failed read costs the Oura workouts, never the budget: it degrades to what was counted before.
 *
 * The logs of the evening before `from` join the overlap check: a 23:30-00:30 log is dated the day
 * it started, outside the caller's range, yet its Oura copy starts after midnight and lands inside
 * it. Read only when there are workouts to check; a log in it is never costed here, only matched.
 */
export async function ouraBudgetActivities(
  repo: Pick<WorkoutRepository, 'getOuraWorkouts' | 'listActivityLogs'>,
  userId: string,
  from: string,
  to: string,
  tz: string,
  counted: CountedMovement,
): Promise<OuraBudgetActivity[]> {
  let rows: Awaited<ReturnType<WorkoutRepository['getOuraWorkouts']>>
  try {
    rows = await repo.getOuraWorkouts(userId, { from: shiftDateStr(from, -1), to: shiftDateStr(to, 1) })
  } catch {
    return []
  }
  if (rows.length === 0) return []
  const dayBefore = shiftDateStr(from, -1)
  let eveningBefore: CountedMovement['activityLogs'] = []
  try {
    eveningBefore = await repo.listActivityLogs(userId, dayBefore, dayBefore)
  } catch {
    // Without them only a midnight-crossing log on the range's first night goes unmatched.
  }
  const withEveningBefore = { ...counted, activityLogs: [...eveningBefore, ...counted.activityLogs] }
  return ouraWorkoutActivities(rows, withEveningBefore, tz).filter(a => a.date >= from && a.date <= to)
}
