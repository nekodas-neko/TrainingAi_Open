import { plural } from '@trainingai/shared/format/plural';
import { deadLettered } from '../../../core/sync/set-aside.ts';
import type { SyncBoard, SyncReason } from '../../../core/sync/deadline.ts';
import { waitingCount } from '../../activities/data/sync-health.ts';
import { pendingBy, type PendingSources } from './device-uploads.ts';
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
      getSnapshot(): { pending?: number; error: string | null; enabled: boolean; busy?: boolean; needsPermission?: boolean; sheetOpen?: boolean };
      subscribe?: Subscribe;
    } | null;
    refresh(options?: { ask?: boolean }): Promise<unknown>;
  };
  activities: SyncableStore | null;
  history: SyncableStore | null;
  strap?: { sync(): unknown; getSnapshot?(): { queued: number } } | null;
  scale?: { sync(): unknown; getSnapshot?(): { queued: number } } | null;
  download: { getSnapshot(): { status: string }; subscribe?: Subscribe } | null;
  today: string;
  deviceHealthName: string;
  refreshWorkouts(): void;
  refreshAccountViews(restore: boolean): Promise<unknown>;
};

const none = { operations: [], http: [] } as const;
/** The same tally the sign-out sheet shows, read live from each store (not a render's copy). */
function livePending(deps: SyncNowDeps): ReturnType<typeof pendingBy> {
  const snap = (store: SyncableStore | null) => (store ? store.getSnapshot() : none);
  const activities = deps.activities?.getSnapshot();
  const sources: PendingSources = {
    health: { operations: snap(deps.health).operations ?? [] },
    home: { operations: snap(deps.home).operations ?? [] },
    nutrition: {
      operations: snap(deps.nutrition).operations ?? [],
      http: snap(deps.nutrition).http ?? [],
    },
    training: { operations: snap(deps.training).operations ?? [] },
    journal: deps.journal?.getSnapshot() ?? { data: { workouts: [] } },
    imported: { pending: deps.imported.store?.getSnapshot().pending ?? 0 },
    activities: {
      pending: activities
        ? waitingCount({ rows: [], tests: [], runs: [], ...activities } as Parameters<typeof waitingCount>[0])
        : 0,
    },
    history: { operations: snap(deps.history).operations ?? [] },
    devices: {
      strapSamples: deps.strap?.getSnapshot?.().queued ?? 0,
      scaleReadings: deps.scale?.getSnapshot?.().queued ?? 0,
    },
  };
  return pendingBy(sources);
}

const subscribeOf = (store: { subscribe?: Subscribe } | null | undefined) =>
  store?.subscribe ? (notify: () => void) => store.subscribe!(notify) : undefined;

/** What a store's own state says is left after its sync: its error, else a count of what waits. */
export function queuedReason(snapshot: Snapshot): SyncReason | null {
  if (snapshot.error) return snapshot.error;
  const rows = [
    ...(snapshot.operations ?? []),
    ...(snapshot.http ?? []),
    ...[...(snapshot.rows ?? []), ...(snapshot.tests ?? []), ...(snapshot.runs ?? [])].filter(
      (row) => row.pending,
    ),
  ];
  const refused = rows.filter(refusedRow).length;
  if (refused) return { refused };
  if (rows.length) return `${plural(rows.length, 'change', 'changes')} not uploaded yet`;
  return null;
}
/** The workout journal publishes its errors on each workout; only finished workouts upload. */
export function journalReason(snapshot: JournalSnapshot): SyncReason | null {
  const queued = snapshot.data.workouts
    .filter((workout) => workout.status === 'completed')
    .flatMap((workout) => workout.pending.map((item) => ({ item, workout })));
  const refused = queued.filter(({ item }) => refusedRow(item)).length;
  if (refused) return { refused, what: 'workout' };
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
  // While the system sheet is open the import is waiting on a person, not reading (#3906).
  board.also(() =>
    imported.store?.getSnapshot().sheetOpen
      ? 'Waiting for your answer in Health Connect.'
      : importing()
        ? 'Health Connect import still reading.'
        : null,
  );
  board.also(() =>
    deps.download?.getSnapshot().status === 'running' ? 'History download still running.' : null,
  );
  for (const target of [health, home, nutrition, training, journal, activities, history, imported.store])
    board.watch(subscribeOf(target as { subscribe?: Subscribe } | null));
  board.watch(subscribeOf(deps.download));
  if (journal) board.check('Workouts', () => journalReason(journal.getSnapshot()));
  if (imported.store)
    board.check('Health Connect', () => importStatusError(imported.store!.getSnapshot()));
  // Every store the sign-out sheet counts is named while it still reads above zero, so "Sync
  // finished" is never shown over a count the sheet would show (#3906 second check).
  for (const label of Object.keys(livePending(deps)) as (keyof ReturnType<typeof pendingBy>)[])
    board.count(label, () => {
      const left = livePending(deps)[label];
      return left > 0 ? `${plural(left, 'change', 'changes')} not uploaded yet` : null;
    });
  for (const target of [deps.strap, deps.scale]) {
    const watch = target as { subscribe?: Subscribe } | null | undefined;
    board.watch(subscribeOf(watch));
  }
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
