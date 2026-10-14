import type { AccountConnection } from '../../features/account/session.ts';

export type PendingWrite = {
  id: string;
  domain: 'workout_log' | 'complete_workout';
  date: string;
  payload: Record<string, unknown>;
};

export async function pushMutation(connection: AccountConnection, mutation: PendingWrite) {
  const response = await connection.post('/api/sync/push', { mutations: [mutation] });
  if (
    !response ||
    typeof response !== 'object' ||
    !('errors' in response) ||
    !Array.isArray(response.errors)
  ) {
    throw new Error(
      'The backend did not confirm the workout upload. Your workout is kept on this phone.',
    );
  }
  if (response.errors.length > 0) {
    throw new Error(
      'The backend could not save this workout yet. Your workout is kept on this phone.',
    );
  }
  if (!('processed' in response) || response.processed !== 1) {
    throw new Error(
      'The backend did not confirm the workout upload. Your workout is kept on this phone.',
    );
  }
}
