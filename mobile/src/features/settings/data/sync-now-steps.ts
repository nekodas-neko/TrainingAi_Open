import { plural } from '@trainingai/shared/format/plural';
import { deadLettered } from '../../../core/sync/set-aside.ts';
import type { SyncBoard } from '../../../core/sync/deadline.ts';
import { importPermissionNote, importStatusError } from '../../health/data/device-import.ts';

type Row = object;
const refusedRow = (row: Row) => deadLettered(row as { rejected?: { attempts: number } });
type Snapshot = {
  error?: string | null;
  operations?: readonly Row[];
  http?: readonly Row[];
  rows?: readonly (Row & { pending: boolean })[];
  tests?: readonly (Row & { pending: boolean })[];
  runs?: readonly (Row & { pending: boolean })[];
};
type Subscribe = (listener: () => void) => () => void;
export type SyncableStore = {
  sync(): Promise<unknown>;
  getSnapshot(): Snapshot;
  subscribe?: Subscribe;
};
type JournalSnapshot = {
  data: {
    workouts: {
      status: string;
      pending: readonly Row[];
      syncError?: string | null;
    }[];
  };
};
export type SyncNowDeps = {
  health: (SyncableStore & { refresh(manual: boolean): Promise<unknown> }) | null;
  home:
    | (SyncableStore & {
        refresh(kind: 'preferences' | 'mood', date: string, manual: boolean): Promise<unknown>;
      })
    | null;
  nutrition:
    | (SyncableStore & {
        refresh(kind: string, date: string, manual: boolean): Promise<unknown>;
      })
    | null;
  training: SyncableStore | null;
  journal: { sync(): Promise<unknown>; getSnapshot(): JournalSnapshot; subscribe?: Subscribe } | null;
  imported: {
    store: {
      getSnapshot(): { error: string | null; enabled: boolean; busy?: boolean; needsPermission?: boolean };
      subscribe?: Subscribe;
    } | null;
    refresh(options?: { ask?: boolean }): Promise<unknown>;
  };
  activities: SyncableStore | null;
  history: SyncableStore | null;
  strap?: { sync(): unknown } | null;
  scale?: { sync(): unknown } | null;
  download: { getSnapshot(): { status: string }; subscribe?: Subscribe } | null;
  today: string;
  deviceHealthName: string;
  refreshWorkouts(): void;
  refreshAccountViews(restore: boolean): Promise<unknown>;
};

const subscribeOf = (store: { subscribe?: Subscribe } | null | undefined) =>
  store?.subscribe ? (notify: () => void) => store.subscribe!(notify) : undefined;

/** What a store's own state says is left after its sync: its error, else a count of what waits. */
export function queuedReason(snapshot: Snapshot): string | null {
  if (snapshot.error) return snapshot.error;
  const rows = [
    ...(snapshot.operations ?? []),
    ...(snapshot.http ?? []),
    ...[...(snapshot.rows ?? []), ...(snapshot.tests ?? []), ...(snapshot.runs ?? [])].filter(
      (row) => row.pending,
    ),
  ];
  const refused = rows.filter(refusedRow).length;
  if (refused)
    return `${plural(refused, 'change', 'changes')} refused by the server. Use Retry or Discard`;
  if (rows.length) return `${plural(rows.length, 'change', 'changes')} not uploaded yet`;
  return null;
}
/** The workout journal publishes its errors on each workout; only finished workouts upload. */
export function journalReason(snapshot: JournalSnapshot): string | null {
  const queued = snapshot.data.workouts
    .filter((workout) => workout.status === 'completed')
    .flatMap((workout) => workout.pending.map((item) => ({ item, workout })));
  const refused = queued.filter(({ item }) => refusedRow(item)).length;
  if (refused)
    return `${plural(refused, 'workout change', 'workout changes')} refused by the server. Use Retry or Discard`;
  if (!queued.length) return null;
  return (
    queued.find(({ workout }) => workout.syncError)?.workout.syncError ??
    `${plural(queued.length, 'workout change', 'workout changes')} not uploaded yet`
  );
}

/**
 * Sync now's steps, in order. Each store is one named step with a bound; after it, the store's own
 * error and pending count are read (live) so a store that never throws still names what waits. A
 * sync never opens a permission sheet (`ask: false`, #3906).
 */
export async function runSyncNow(board: SyncBoard, deps: SyncNowDeps, restore: boolean) {
  const { health, home, nutrition, training, journal, imported, activities, history } = deps;
  const store = (label: string, target: SyncableStore | null) =>
    board.step(label, target && (() => target.sync()), undefined, {
      check: target ? () => queuedReason(target.getSnapshot()) : undefined,
    });
  const importing = () => !!imported.store?.getSnapshot().busy;
  // Sources that can still be going when the run ends are named in its result (#3906).
  board.also(() => (importing() ? 'Health Connect import still reading.' : null));
  board.also(() =>
    deps.download?.getSnapshot().status === 'running' ? 'History download still running.' : null,
  );
  for (const target of [health, home, nutrition, training, journal, activities, history, imported.store])
    board.watch(subscribeOf(target as { subscribe?: Subscribe } | null));
  board.watch(subscribeOf(deps.download));
  if (journal) board.check('Workouts', () => journalReason(journal.getSnapshot()));
  if (imported.store)
    board.check('Health Connect', () => importStatusError(imported.store!.getSnapshot()));
  await Promise.all([
    store('Health', health),
    store('Home', home),
    store('Nutrition', nutrition),
    store('Training', training),
    board.step('Workouts', journal && (() => journal.sync())),
    // A sync never opens a system permission sheet: that is the Allow button's job (#3906).
    board.step('Health Connect', () => imported.refresh({ ask: false }), undefined, {
      still: () => (importing() ? 'import still reading' : null),
    }),
    store('Activities', activities),
    store('History edits', history),
  ]);
  // Counted above, so sent here too; each publishes its own count when its upload settles.
  deps.strap?.sync();
  deps.scale?.sync();
  await Promise.all([
    board.step('Health', async () => health?.refresh(true)),
    board.step('Home', async () => {
      await home?.refresh('preferences', deps.today, true);
      await home?.refresh('mood', deps.today, true);
    }),
  ]);
  if (restore) {
    await board.step('Nutrition', () =>
      Promise.all(
        ['mealTypes', 'foods', 'meals', 'supplements', 'targets', 'logs'].map((kind) =>
          nutrition?.refresh(kind, deps.today, true),
        ),
      ),
    );
  }
  deps.refreshWorkouts();
  await board.step('Account views', () => deps.refreshAccountViews(restore));
  // #3906: switched on with no permission is a note on a finished sync, not a failed one.
  const note = imported.store
    ? importPermissionNote(imported.store.getSnapshot(), deps.deviceHealthName)
    : null;
  return (
    (restore
      ? 'Account data refreshed. Your history is now saving to this phone for offline use.'
      : 'Sync finished. Any changes still waiting to upload remain saved on this phone.') +
    (note ? ` ${note}` : '')
  );
}
