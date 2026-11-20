// The completion write for `POST /api/complete-workout`: looks up the repository and runs
// `completeWorkoutWithRepo` (`./complete-workout-core`), which the outbox push calls with its own
// (#3916).
import type { CompleteWorkoutPayload } from './complete-payload'
import { completeWorkoutWithRepo } from './complete-workout-core'

export { CompleteWorkoutPayloadSchema } from './complete-payload'
export type { CompleteWorkoutPayload } from './complete-payload'
export { COMPLETED_AT_FUTURE_TOLERANCE_MS, resolveCompletedAt, completeWorkoutWithRepo } from './complete-workout-core'

export async function completeWorkoutFromPayload(
  userId: string,
  payload: CompleteWorkoutPayload,
): ReturnType<typeof completeWorkoutWithRepo> {
  // Lazy import, for the reason `./log-exercise.ts` gives.
  const { getRepository } = await import('@/lib/data')
  return completeWorkoutWithRepo(await getRepository(), userId, payload)
}
