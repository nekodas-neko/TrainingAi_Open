import {
  deadLettered,
  failedItem,
  type FailedItem,
  type RetryState,
} from '../../../core/sync/set-aside.ts';
// The pure half of the Sync health card (the current app's `components/more/sync-health-card.tsx`):
// which queued rows the server has given up on, how the card words them, and what Retry and
// Discard do to the queue. The rule for when a row is given up on is `core/sync/set-aside.ts`,
// shared by every Preview outbox.
type Refusal = { attempts: number; error: string; at: number; retryAt?: number };
type Queued = {
  pending: boolean;
  rejected?: Refusal;
  payload: { id: string; date?: string };
};
type Queues = {
  rows: Queued[];
  tests: Queued[];
  runs: (Queued & { date: string })[];
};
export type QueueList = 'rows' | 'tests' | 'runs';
export { deadLettered, type FailedItem };
// The current app's domains for activity_logs, fitness_tests and prescribed_run.
const domains: Record<QueueList, string> = {
  rows: 'activity_logs',
  tests: 'fitness_tests',
  runs: 'prescribed_run',
};
const lists: QueueList[] = ['rows', 'tests', 'runs'];
export function isActivityList(list: string): list is QueueList {
  return (lists as string[]).includes(list);
}
export function failedItems(queues: Queues): FailedItem[] {
  return lists.flatMap((list) =>
    (queues[list] as (Queued & { date?: string })[])
      .filter((row) => row.pending && deadLettered(row))
      .map((row) =>
        failedItem(list, row.payload.id, domains[list], row.date ?? row.payload.date ?? '', row.rejected!),
      ),
  );
}
// Rows still on their way up: a dead-lettered row is not one of them.
export function waitingCount(queues: Queues) {
  return lists.reduce(
    (sum, list) => sum + queues[list].filter((row) => row.pending && !deadLettered(row)).length,
    0,
  );
}
export function failedHeading(count: number) {
  return `${count} change${count > 1 ? 's' : ''} failed to sync`;
}
export function itemTitle(item: FailedItem) {
  return item.date ? `${item.label} — ${item.date}` : item.label;
}
export function itemDetail(item: FailedItem) {
  return `${item.error || 'Unknown error'} (${item.attempts} attempts)`;
}
type Data = Pick<Queues, QueueList>;
// Retry: forget the refusals so the row is a fresh upload (the flush then tries it at once).
export function retryRow<T extends Data>(data: T, list: QueueList, id: string): T {
  return {
    ...data,
    [list]: data[list].map((row) =>
      row.payload.id === id && row.pending && deadLettered(row)
        ? { ...row, rejected: undefined }
        : row,
    ),
  };
}
// Discard: drop that one queued row. Nothing on the server is touched.
export function discardRow<T extends Data>(data: T, list: QueueList, id: string): T {
  return {
    ...data,
    [list]: data[list].filter(
      (row) => !(row.payload.id === id && row.pending && deadLettered(row)),
    ),
  };
}
// Where one activity row stands after a Retry: a row the server refused again carries a new
// refusal; one that never reached the server (no connection) is still pending without one.
export function activityRetryState(queues: Data, item: { list: string; id: string }): RetryState {
  const row = isActivityList(item.list)
    ? queues[item.list].find((queued) => queued.payload.id === item.id)
    : undefined;
  return !row || !row.pending ? 'synced' : row.rejected ? 'failing' : 'waiting';
}
// What a Retry did, from where each retried change stands afterwards.
export function retryNotice(state: RetryState[]) {
  const failing = state.filter((value) => value === 'failing').length;
  const waiting = state.filter((value) => value === 'waiting').length;
  if (failing === state.length) {
    return 'Still failing — see the error below';
  }
  if (failing > 0) {
    return `${state.length - failing} synced, ${failing} still failing`;
  }
  return waiting > 0 ? 'Saved on this phone. It will upload when connected.' : 'Synced';
}
