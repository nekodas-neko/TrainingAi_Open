import { z } from 'zod'
import { getRepository } from '@/lib/data'
import { deleteWorkoutSession } from '@/lib/workout/delete-session'

/** The body of a session delete, for the route and the outbox's `workout_session_delete` alike. */
export const WorkoutSessionDeleteSchema = z.object({ workoutSessionId: z.string().uuid() }).strict()

/**
 * Delete a session and re-derive the personal records it contributed to — the whole write, for both
 * `DELETE /api/workout-sessions` and the outbox's `workout_session_delete` push branch (RV-175).
 * The reconcile used to live in the route alone, so a delete arriving through the outbox would have
 * left a PR standing on a session that no longer exists.
 *
 * Its own module rather than a sibling in `delete-session.ts`: `deleteWorkoutSession` must be reached
 * through an import, or `workout-write-path-routes.test.ts`'s mock of it cannot intercept the call.
 */
export async function deleteWorkoutSessionAndReconcile(
  userId: string,
  workoutSessionId: string,
): Promise<{ deleted: boolean }> {
  const { deleted, exerciseNames } = await deleteWorkoutSession(userId, workoutSessionId)
  if (!deleted) return { deleted }
  const repo = await getRepository()
  for (const name of exerciseNames) {
    await repo.reconcilePersonalRecord(userId, name)
  }
  return { deleted }
}
