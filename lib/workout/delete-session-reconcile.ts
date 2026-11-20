// The session delete for `DELETE /api/workout-sessions`: looks up the repository and runs
// `deleteWorkoutSessionAndReconcileWithRepo` (`./delete-session-reconcile-core`), which the outbox
// push calls with its own (#3916).
import { getRepository } from '@/lib/data'
import { deleteWorkoutSessionAndReconcileWithRepo } from './delete-session-reconcile-core'

export { WorkoutSessionDeleteSchema, deleteWorkoutSessionAndReconcileWithRepo } from './delete-session-reconcile-core'

export async function deleteWorkoutSessionAndReconcile(
  userId: string,
  workoutSessionId: string,
): ReturnType<typeof deleteWorkoutSessionAndReconcileWithRepo> {
  return deleteWorkoutSessionAndReconcileWithRepo(await getRepository(), userId, workoutSessionId)
}
