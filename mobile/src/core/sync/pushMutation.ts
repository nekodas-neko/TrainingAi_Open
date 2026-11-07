import type { AccountConnection } from '../../features/account/session.ts';
import { readPushAnswer } from './push-answer.ts';
import { ChangeRefused } from './set-aside.ts';

export type PendingWrite = {
  id: string;
  domain: 'workout_log' | 'complete_workout';
  date: string;
  payload: Record<string, unknown>;
};

// Sends one workout write. A refusal of it in the server's answer throws ChangeRefused, which the
// journal counts (#3638); anything else that says nothing about it throws a plain error.
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
  const verdict = readPushAnswer(mutation, response);
  if (verdict.kind === 'refused') {
    throw new ChangeRefused(verdict.error);
  }
  if (verdict.kind === 'hold') {
    throw new Error(
      response.errors.length > 0
        ? 'The backend could not save this workout yet. Your workout is kept on this phone.'
        : 'The backend did not confirm the workout upload. Your workout is kept on this phone.',
    );
  }
}
