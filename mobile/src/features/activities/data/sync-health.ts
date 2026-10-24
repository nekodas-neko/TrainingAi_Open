import { MAX_MUTATION_ATTEMPTS } from '@trainingai/shared/sync/push-retry';
// The pure half of the Sync health card (the current app's `components/more/sync-health-card.tsx`):
// which queued rows the server has given up on, how the card words them, and what Retry and
// Discard do to the queue.
type Refusal = { attempts: number; error: string };
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
export function deadLettered(row: { rejected?: { attempts: number } }) {
  return (row.rejected?.attempts ?? 0) >= MAX_MUTATION_ATTEMPTS;
}
// The current app's DOMAIN_LABELS for activity_logs, fitness_tests and prescribed_run.
export const queueLabels: Record<QueueList, string> = {
  rows: 'Activity',
  tests: 'Fitness test',
  runs: 'Prescribed run',
};
const lists: QueueList[] = ['rows', 'tests', 'runs'];
export type FailedItem = {
  list: QueueList;
  id: string;
  label: string;
  date: string;
  error: string;
  attempts: number;
};
export function failedItems(queues: Queues): FailedItem[] {
  return lists.flatMap((list) =>
    (queues[list] as (Queued & { date?: string })[])
      .filter((row) => row.pending && deadLettered(row))
      .map((row) => ({
        list,
        id: row.payload.id,
        label: queueLabels[list],
        date: row.date ?? row.payload.date ?? '',
        error: row.rejected!.error,
        attempts: row.rejected!.attempts,
      })),
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
// What a Retry did, read from the queue afterwards: a row the server refused again carries a new
// refusal; one that never reached the server (no connection) is still pending without one.
export function retryNotice(items: { list: QueueList; id: string }[], queues: Data) {
  const state = items.map((item) => {
    const row = queues[item.list].find((queued) => queued.payload.id === item.id);
    return !row || !row.pending ? 'synced' : row.rejected ? 'failing' : 'waiting';
  });
  const failing = state.filter((value) => value === 'failing').length;
  const waiting = state.filter((value) => value === 'waiting').length;
  if (failing === items.length) {
    return 'Still failing — see the error below';
  }
  if (failing > 0) {
    return `${items.length - failing} synced, ${failing} still failing`;
  }
  return waiting > 0 ? 'Saved on this phone. It will upload when connected.' : 'Synced';
}
