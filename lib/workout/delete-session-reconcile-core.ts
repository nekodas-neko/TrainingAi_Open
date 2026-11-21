// #3916. The data layer's outbox push (`pushMutations` in `lib/data/postgres/adapter.ts`) calls this
// with its own repository. It must not import `@/lib/data`, statically or through `import()`: the
// data layer reaching a module that reaches back into `@/lib/data` is the cycle that broke
// `/api/readiness-score` on the dev bundler (#3911), and
// `lib/health/__tests__/data-layer-readiness-cycle.test.ts` fails if one comes back.
import { z } from 'zod'
import type { WorkoutRepository } from '@/lib/data/repository'
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
export async function deleteWorkoutSessionAndReconcileWithRepo(
  repo: WorkoutRepository,
  userId: string,
  workoutSessionId: string,
): Promise<{ deleted: boolean }> {
  const { deleted, exerciseNames } = await deleteWorkoutSession(userId, workoutSessionId)
  if (!deleted) return { deleted }
  // #3850: the tombstone takes the session's window off the days it covered.
  await repo.dropZoneMinutesForWorkoutSessions(userId, [workoutSessionId])
  for (const name of exerciseNames) {
    await repo.reconcilePersonalRecord(userId, name)
  }
  return { deleted }
}
