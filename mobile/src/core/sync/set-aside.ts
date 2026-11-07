import {
  MAX_MUTATION_ATTEMPTS,
  nextRetryDelayMs,
} from '@trainingai/shared/sync/push-retry';
import { z } from 'zod';
import { isAuthRefusal, isRefusedByServer } from '../../features/account/api/client.ts';

// What the server said when it refused a queued change, kept on the change itself. `attempts`
// counts answers that said something about this change only: a refusal in the push answer, our own
// JSON 4xx, or a read-back that came back and did not show it. A lost connection, a 5xx, a 429 or
// a failed read never counts. At MAX_MUTATION_ATTEMPTS the change is set aside: its queue passes
// over it, and it stays on the phone, with the server's words, for Sync health's Retry / Discard.
//
// One copy for every Preview outbox (#3130 built it for activities; #3638 moved it here).
export const rejectionSchema = z.object({
  error: z.string(),
  at: z.number(),
  attempts: z.number().int().positive(),
  retryAt: z.number().optional(),
});
export type Rejection = z.infer<typeof rejectionSchema>;

export function deadLettered(row: { rejected?: { attempts: number } }) {
  return (row.rejected?.attempts ?? 0) >= MAX_MUTATION_ATTEMPTS;
}

// One more counted refusal. `retryAt` is the backoff a queue that can send its other changes first
// waits out (the activity queue); an ordered queue retries its head on the next sync instead, so the
// changes behind it wait minutes, not the better part of an hour, before it is set aside.
export function countRefusal(previous: Rejection | undefined, error: string, at: number): Rejection {
  const attempts = (previous?.attempts ?? 0) + 1;
  return {
    error,
    at,
    attempts,
    ...(attempts < MAX_MUTATION_ATTEMPTS ? { retryAt: at + nextRetryDelayMs(attempts) } : {}),
  };
}

// A refusal that counts, as the error a queue can throw from deep inside one change's upload and
// catch at its loop. Thrown for an answer about this change; anything else thrown is not counted.
export class ChangeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeRefused';
  }
}

// What a failed upload says about the one change it carried: a refusal to count, or nothing.
export function refusalOf(failure: unknown): string | null {
  if (failure instanceof ChangeRefused) {
    return failure.message;
  }
  // Our own JSON 4xx, other than a 429 (try later) or the sign-in gate (every change would fail
  // alike, and the queue's own sign-in notice says what to do).
  if (isAuthRefusal(failure)) {
    return null;
  }
  if (isRefusedByServer(failure)) {
    return `push rejected: HTTP ${failure.status}`;
  }
  return null;
}

// The current app's DOMAIN_LABELS (components/more/sync-health-card.tsx), and the Preview queues
// the current app has no outbox for.
export const changeLabels: Record<string, string> = {
  activity_logs: 'Activity',
  fitness_tests: 'Fitness test',
  prescribed_run: 'Prescribed run',
  food_logs: 'Food log',
  food_items: 'Food item',
  supplement_logs: 'Supplement log',
  supplements: 'Supplement',
  injuries: 'Injury',
  day_checkins: 'Day check-in',
  saved_meals: 'Saved meal',
  plan_meal_answers: 'Planned meal answer',
  workout_log: 'Workout',
  complete_workout: 'Workout completion',
  exercise_log_edit: 'Edited exercise',
  exercise_log_delete: 'Deleted exercise',
  workout_session_delete: 'Deleted workout',
  program_save: 'Program',
  program_delete: 'Deleted program',
  injury_save: 'Injury',
  injury_resolve: 'Resolved injury',
  injury_delete: 'Deleted injury',
  targets: 'Nutrition targets',
  complete: 'Food logging complete',
  restrictions: 'Dietary restrictions',
  'plan-link': 'Planned meal link',
  'meal-status': 'Meal skipped',
};

// One set-aside change as Sync health lists it. `list` names the queue that holds it.
export type FailedItem = {
  list: string;
  id: string;
  label: string;
  date: string;
  error: string;
  attempts: number;
};
export function failedItem(
  list: string,
  id: string,
  kind: string,
  date: string,
  rejected: Rejection,
): FailedItem {
  return {
    list,
    id,
    label: changeLabels[kind] ?? 'Change',
    date,
    error: rejected.error,
    attempts: rejected.attempts,
  };
}
// Where a change stands after a Retry: gone from its queue, refused again, or waiting to upload.
export type RetryState = 'synced' | 'failing' | 'waiting';
// A queue as Sync health sees it: the changes it has set aside, and what Retry and Discard do.
export type SetAsideQueue = {
  failed: FailedItem[];
  retry(item: FailedItem): Promise<void>;
  discard(item: FailedItem): Promise<void>;
  state(item: FailedItem): RetryState;
};
