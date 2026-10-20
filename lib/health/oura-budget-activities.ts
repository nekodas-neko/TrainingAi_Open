import type { WorkoutRepository } from '@/lib/data/repository'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { ouraWorkoutActivities, type CountedMovement, type OuraBudgetActivity } from '@trainingai/shared/health/oura-workout-activities'

/**
 * Oura's own workouts on `[from, to]` as energy-budget activities, minus what the caller already
 * counts (#3087; the rules are `ouraWorkoutActivities`). The read is widened a day each side because
 * Oura files a workout under its own day while the budget keys it by the local day of its start.
 * A failed read costs the Oura workouts, never the budget: it degrades to what was counted before.
 */
export async function ouraBudgetActivities(
  repo: Pick<WorkoutRepository, 'getOuraWorkouts'>,
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
  return ouraWorkoutActivities(rows, counted, tz).filter(a => a.date >= from && a.date <= to)
}
