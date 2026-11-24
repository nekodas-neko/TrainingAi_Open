import { useSyncExternalStore } from 'react';
import { UPLOAD_BATCH } from '../../devices/strap/HrOutbox.ts';

/**
 * What the strap and scale outboxes add to Data & Sync's "changes waiting to upload" (#3655). Each
 * weigh-in is one change. The strap saves a sample a second, so its samples count as the uploads
 * still to send (`UPLOAD_BATCH` samples each): a walk's heart rate is a change or two, not a
 * thousand, and any sample left makes the count non-zero.
 */
export function deviceUploadsWaiting(queued: { strapSamples: number; scaleReadings: number }) {
  return Math.ceil(Math.max(0, queued.strapSamples) / UPLOAD_BATCH) + Math.max(0, queued.scaleReadings);
}

type QueuedSource = { subscribe: (listener: () => void) => () => void; getSnapshot: () => { queued: number } };
const noSubscribe = () => () => {};

/** One outbox's published `queued`, zero where that device's provider is not mounted. */
export function useQueued(session: QueuedSource | null) {
  const read = () => session?.getSnapshot().queued ?? 0;
  return useSyncExternalStore(session?.subscribe ?? noSubscribe, read, read);
}

type Queue = readonly object[];
/** What every counted store has waiting; the one place the Data & Sync tally is defined. */
export type PendingSources = {
  health: { operations: Queue };
  home: { operations: Queue };
  nutrition: { operations: Queue; http: Queue };
  training: { operations: Queue };
  journal: { data: { workouts: readonly { pending: Queue }[] } };
  imported: { pending: number };
  /** Rows still on their way up (a dead-lettered row is not one of them). */
  activities: { pending: number };
  history: { operations: Queue };
  devices: { strapSamples: number; scaleReadings: number };
};
export function pendingBy(s: PendingSources) {
  return {
    Health: s.health.operations.length,
    Home: s.home.operations.length,
    Nutrition: s.nutrition.operations.length + s.nutrition.http.length,
    Training: s.training.operations.length,
    Workouts: s.journal.data.workouts.reduce((sum, row) => sum + row.pending.length, 0),
    'Health Connect': s.imported.pending,
    Activities: s.activities.pending,
    'History edits': s.history.operations.length,
    'Strap and scale': deviceUploadsWaiting(s.devices),
  };
}
/** The number the sign-out sheet and Data & Sync show, and what Sync now's result checks. */
export function pendingChanges(s: PendingSources) {
  return Object.values(pendingBy(s)).reduce((sum, count) => sum + count, 0);
}
