import {
  MAX_MUTATION_ATTEMPTS,
  resolveFailedOutboxIds,
  type PushErrorRecord,
} from '@trainingai/shared/sync/push-retry';

/**
 * What a queue should do with the one mutation it sent to `/api/sync/push`. The rules are the
 * shared ones (`resolveFailedOutboxIds`, `MAX_MUTATION_ATTEMPTS`), the same ActivityStore applies:
 * `accepted` (done), `hold` (the server could not write, or the answer says nothing settled; try
 * again, count nothing), `refused` with the attempt number this refusal makes, and `final` once
 * that reaches MAX_MUTATION_ATTEMPTS, when the caller sets the op aside.
 */
export type PushVerdict =
  | { kind: 'accepted' }
  | { kind: 'hold'; error: string }
  | { kind: 'refused'; error: string; attempts: number; final: boolean };

export function readPushAnswer(
  op: { id: string; domain: string; date: string; attempts?: number },
  answer: { processed?: unknown; errors?: unknown },
): PushVerdict {
  const errors = (Array.isArray(answer.errors) ? answer.errors : []).filter(
    (entry): entry is PushErrorRecord =>
      !!entry && typeof entry === 'object' && typeof (entry as PushErrorRecord).domain === 'string',
  );
  const failure = resolveFailedOutboxIds([op], errors).get(op.id);
  if (failure?.retryable) {
    return { kind: 'hold', error: failure.error };
  }
  if (failure) {
    const attempts = (op.attempts ?? 0) + 1;
    return {
      kind: 'refused',
      error: failure.error,
      attempts,
      final: attempts >= MAX_MUTATION_ATTEMPTS,
    };
  }
  if (answer.processed !== 1 || (Array.isArray(answer.errors) && answer.errors.length)) {
    return { kind: 'hold', error: 'Upload not confirmed.' };
  }
  return { kind: 'accepted' };
}
