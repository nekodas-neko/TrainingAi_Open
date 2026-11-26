// The log-exercise write for `POST /api/log-exercise`: looks up the repository and runs
// `logExerciseWithRepo` (`./log-exercise-core`), which the outbox push calls with its own (#3916).
import type { EditStamp } from '@trainingai/shared/sync/edited-at';
import type { LogExercisePayload } from './log-payload';
import { logExerciseWithRepo } from './log-exercise-core';

export { LogExercisePayloadSchema, LogExerciseUploadSchema } from './log-payload';
export type { LogExercisePayload } from './log-payload';
export { shouldCountTowardPr, logExerciseWithRepo } from './log-exercise-core';

export async function logExerciseFromPayload(
  userId: string,
  payload: LogExercisePayload,
  tz: string,
  stamp?: EditStamp,
): ReturnType<typeof logExerciseWithRepo> {
  // Lazy import: `@/lib/data` compiles as a Turbopack async module (it pulls in pg /
  // node-postgres), and a static top-level import of it here left the route's namespace binding
  // empty under `next dev --turbopack` (docs/superpowers/plans/2026-07-05-log-exercise-turbopack-dev-fix.md).
  const { getRepository } = await import('@/lib/data');
  return logExerciseWithRepo(await getRepository(), userId, payload, tz, stamp);
}
