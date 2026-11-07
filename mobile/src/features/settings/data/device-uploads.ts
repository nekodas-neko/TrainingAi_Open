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
