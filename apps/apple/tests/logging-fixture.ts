import { workoutFixture } from './workout-fixture.ts';
import { buildCatalog } from '../src/features/workouts/catalog.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

export const programId = '10000000-0000-4000-8000-000000000001';
export const sessionId = '10000000-0000-4000-8000-000000000002';
export const exerciseId = '10000000-0000-4000-8000-000000000003';
export function loggingFixture(userId = 'user-one') {
  const f = workoutFixture(userId);
  f.meta.program.id = programId;
  f.meta.program.sessions[0].id = sessionId;
  f.meta.program.sessions[0].programId = programId;
  f.meta.program.sessions[0].exercises[0].id = exerciseId;
  f.all.perSession['session-one'].exercises[0].sessionExerciseId = exerciseId;
  const response = f.all.perSession['session-one'];
  const all = { perSession: { [sessionId]: response } };
  const catalog = buildCatalog(f.meta, f.next, all, f.reader);
  const requests: unknown[] = [];
  const connection: AccountConnection = {
    origin: f.reader.origin,
    userId,
    timezone: 'Australia/Brisbane',
    get: async (path, query) => {
      if (path === '/api/workout-data' && query?.tab === sessionId) {
        return response;
      }
      if (query?.tab === 'all') {
        return all;
      }
      return f.reader.get(path, query);
    },
    post: async (path, body) => {
      requests.push({ path, body });
      return { processed: 1, errors: [] };
    },
  };
  let sequence = 10;
  const uuid = () => `20000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
  return {
    ...f,
    all,
    catalog,
    response,
    session: catalog.program!.sessions[0],
    connection,
    requests,
    uuid,
  };
}
