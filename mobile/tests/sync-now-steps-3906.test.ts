import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SYNC_NOW_END_MS,
  SYNC_STEP_LIMIT_MS,
  SyncBoard,
} from '../src/core/sync/deadline.ts';
import {
  createSyncNowShared,
} from '../src/features/settings/data/sync-now-state.ts';
import {
  journalReason,
  queuedReason,
  runSyncNow,
  type SyncNowDeps,
} from '../src/features/settings/data/sync-now-steps.ts';
import { permissionAnswer } from '../src/features/health/data/device-import.ts';

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};
// A store whose own state the test sets, as the real ones publish theirs.
function fake(log: string[], name: string, state: { error?: string | null; operations?: object[] } = {}) {
  const listeners = new Set<() => void>();
  const store = {
    state,
    sync: async (): Promise<void> => {
      log.push(`${name}.sync`);
    },
    refresh: async (...args: unknown[]) => void log.push(`${name}.refresh:${args.join(',')}`),
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit: () => listeners.forEach((fn) => fn()),
  };
  return store;
}
function deps(log: string[], over: Partial<SyncNowDeps> = {}) {
  const base: SyncNowDeps = {
    health: fake(log, 'health'),
    home: fake(log, 'home'),
    nutrition: fake(log, 'nutrition'),
    training: fake(log, 'training'),
    journal: {
      sync: async () => void log.push('journal.sync'),
      getSnapshot: () => ({ data: { workouts: [] } }),
    },
    imported: {
      store: { getSnapshot: () => ({ error: null, enabled: true, busy: false }) },
      refresh: async (options) => void log.push(`import.refresh:${JSON.stringify(options)}`),
    },
    activities: fake(log, 'activities'),
    history: fake(log, 'history'),
    strap: { sync: () => void log.push('strap.sync') },
    scale: { sync: () => void log.push('scale.sync') },
    download: null,
    today: '2026-11-20',
    deviceHealthName: 'Health Connect',
    refreshWorkouts: () => void log.push('workouts.refresh'),
    refreshAccountViews: async (restore) => void log.push(`views:${restore}`),
  };
  return { ...base, ...over };
}
const outcome = async (d: SyncNowDeps, restore = false) => {
  const board = new SyncBoard();
  const message = await runSyncNow(board, d, restore);
  return { board, message };
};

test('the hook\'s step list: Health Connect is read with ask: false, and the order holds', async () => {
  const log: string[] = [];
  await outcome(deps(log));
  assert.ok(log.includes('import.refresh:{"ask":false}'), 'a sync asks for no permission');
  const first = (name: string) => log.indexOf(name);
  for (const upload of ['health.sync', 'home.sync', 'nutrition.sync', 'training.sync', 'journal.sync', 'activities.sync', 'history.sync'])
    assert.ok(first(upload) >= 0 && first(upload) < first('health.refresh:true'), upload);
  assert.ok(first('strap.sync') > first('history.sync') && first('strap.sync') < first('health.refresh:true'));
  assert.ok(first('home.refresh:preferences,2026-11-20,true') > first('health.refresh:true') - 3);
  assert.ok(first('workouts.refresh') < first('views:false'));
  assert.equal(log.at(-1), 'views:false', 'account views come last');
  const restore: string[] = [];
  await outcome(deps(restore), true);
  assert.ok(restore.some((line) => line.startsWith('nutrition.refresh:logs')));
  assert.equal(restore.at(-1), 'views:true');
});

test('the hook wires the one shared runner and the step list, not its own copies', () => {
  const source = readFileSync(new URL('../src/features/settings/data/useNativeDataActions.ts', import.meta.url), 'utf8');
  assert.match(source, /syncNowShared\.run\(/);
  assert.match(source, /runSyncNow\(/);
  assert.doesNotMatch(source, /syncNowRunner\(/, 'one runner for the app, not one per screen');
  assert.doesNotMatch(source, /refresh\(\{ ask: true|ask: true/);
});

test('Training that never throws but holds a busy program upload is named, with its reason', async () => {
  const log: string[] = [];
  const training = fake(log, 'training', {
    error: 'The server is busy saving another change. This will upload shortly.',
    operations: [{ id: 'a' }],
  });
  const { board } = await outcome(deps(log, { training }));
  assert.deepEqual(board.waiting(), [
    { label: 'Training', reason: 'the server is busy saving another change. this will upload shortly' },
  ]);
});

test('a refused Training change and a refused workout say refused, and point to Retry or Discard', async () => {
  const log: string[] = [];
  const refused = { rejected: { attempts: 99 } };
  const training = fake(log, 'training', { operations: [refused] });
  const journal = {
    sync: async () => {},
    getSnapshot: () => ({ data: { workouts: [{ status: 'completed', pending: [refused] }] } }),
  };
  const { board } = await outcome(deps(log, { training, journal }));
  const rows = board.waiting();
  assert.match(rows.find((row) => row.label === 'Training')?.reason ?? '', /refused by the server.*retry or discard/);
  assert.match(rows.find((row) => row.label === 'Workouts')?.reason ?? '', /refused by the server.*retry or discard/);
});

test('the workout journal reports its own sync error, offline, and an unfinished workout is not "waiting"', () => {
  const offline = 'Workout saved on this phone. Upload is pending; retry when connected.';
  assert.equal(
    journalReason({ data: { workouts: [{ status: 'completed', pending: [{}], syncError: offline }] } }),
    offline,
  );
  assert.equal(journalReason({ data: { workouts: [{ status: 'active', pending: [{}] }] } }), null);
  assert.equal(queuedReason({ operations: [{}, {}] }), '2 changes not uploaded yet');
  assert.equal(queuedReason({}), null);
  assert.equal(queuedReason({ error: 'offline' }), 'offline');
  assert.equal(queuedReason({ rows: [{ pending: true }], runs: [{ pending: false }] }), '1 change not uploaded yet');
});

test('every store with a failure on its own state is named; the ones that are clean are not', async () => {
  const log: string[] = [];
  const d = deps(log, {
    nutrition: fake(log, 'nutrition', { error: 'Offline.' }),
    activities: fake(log, 'activities', { operations: [{}] }),
  });
  const { board } = await outcome(d);
  assert.deepEqual(board.waiting().map((row) => row.label), ['Nutrition', 'Activities']);
});

test('the three sources are named when one is still going', async () => {
  const log: string[] = [];
  let reading = true,
    status = 'running';
  const d = deps(log, {
    imported: {
      store: { getSnapshot: () => ({ error: null, enabled: true, busy: reading }) },
      refresh: async () => {},
    },
    download: { getSnapshot: () => ({ status }) },
  });
  const { board } = await outcome(d);
  assert.match(board.alsoText(), /Health Connect import still reading\./);
  assert.match(board.alsoText(), /History download still running\./);
  reading = false;
  status = 'complete';
  assert.equal(board.alsoText(), '');
});

test('a Health Connect step that is given up on says it is still reading, not just "no answer"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: string[] = [];
  const d = deps(log, {
    imported: {
      store: { getSnapshot: () => ({ error: null, enabled: true, busy: true }) },
      refresh: () => new Promise(() => {}),
    },
  });
  const board = new SyncBoard();
  const run = runSyncNow(board, d, false);
  await flush();
  t.mock.timers.tick(SYNC_STEP_LIMIT_MS);
  await run;
  assert.deepEqual(board.waiting(), [{ label: 'Health Connect', reason: 'import still reading' }]);
});

test('a notice naming a store that was still waiting is replaced when that store finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: string[] = [];
  const shared = createSyncNowShared();
  let finish: () => void = () => {};
  const nutrition = fake(log, 'nutrition');
  nutrition.sync = () => new Promise<void>((resolve) => (finish = resolve));
  const pending = shared.run((board) => runSyncNow(board, deps(log, { nutrition }), false));
  await flush();
  t.mock.timers.tick(SYNC_STEP_LIMIT_MS);
  await pending;
  assert.match(shared.getSnapshot().error ?? '', /Still waiting: Nutrition \(no answer yet\)/);
  assert.equal(shared.getSnapshot().busy, false);
  finish();
  await flush();
  assert.equal(shared.getSnapshot().error, null, 'nothing claims Nutrition is waiting any more');
  assert.match(shared.getSnapshot().message ?? '', /^Sync finished\./);
});

test('a store that finishes late with an error is named with that error, not "no answer yet"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: string[] = [];
  const shared = createSyncNowShared();
  let fail: (e: Error) => void = () => {};
  const training = fake(log, 'training');
  training.sync = () => new Promise<void>((_, reject) => (fail = reject));
  const pending = shared.run((board) => runSyncNow(board, deps(log, { training }), false));
  await flush();
  t.mock.timers.tick(SYNC_STEP_LIMIT_MS);
  await pending;
  fail(new Error('Offline.'));
  await flush();
  assert.match(shared.getSnapshot().error ?? '', /Training \(offline\)/);
  assert.doesNotMatch(shared.getSnapshot().error ?? '', /no answer yet/);
});

test('a store that clears its own error after the run ends clears the notice', async () => {
  const log: string[] = [];
  const shared = createSyncNowShared();
  const training = fake(log, 'training', { error: 'Offline.' });
  await shared.run((board) => runSyncNow(board, deps(log, { training }), false));
  assert.match(shared.getSnapshot().error ?? '', /Training \(offline\)/);
  training.state.error = null;
  training.emit();
  assert.equal(shared.getSnapshot().error, null);
  assert.match(shared.getSnapshot().message ?? '', /^Sync finished/);
});

test('a new run takes the screen back: a late finish of the old run changes nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log: string[] = [];
  const shared = createSyncNowShared();
  let finish: () => void = () => {};
  const slow = fake(log, 'nutrition');
  let calls = 0;
  slow.sync = (): Promise<void> =>
    ++calls === 1 ? new Promise<void>((resolve) => (finish = resolve)) : Promise.resolve();
  const first = shared.run((board) => runSyncNow(board, deps(log, { nutrition: slow }), false));
  await flush();
  t.mock.timers.tick(SYNC_STEP_LIMIT_MS);
  await first;
  // A second tap: a new run starts, and the old nutrition sync is still out there. Sync of the
  // store itself coalesces on its own in-flight promise (upload paths), so nothing is sent twice.
  const second = shared.run((board) => runSyncNow(board, deps(log, { nutrition: slow }), false));
  await second;
  const after = { ...shared.getSnapshot() };
  finish();
  await flush();
  assert.deepEqual(shared.getSnapshot(), after);
});

test('one runner for the app: a run started on one screen is the run the others join and show', async () => {
  const shared = createSyncNowShared();
  let starts = 0,
    release: () => void = () => {};
  const work = async (board: SyncBoard) => {
    starts++;
    await board.step('Home', () => new Promise<void>((resolve) => (release = resolve)));
    return 'Sync finished.';
  };
  const fromDataAndSync = shared.run(work),
    fromSignOut = shared.run(work),
    fromDelete = shared.run(work);
  assert.equal(starts, 1);
  assert.equal(fromDataAndSync, fromSignOut);
  assert.equal(fromSignOut, fromDelete);
  assert.equal(shared.getSnapshot().busy, true, 'every screen reads the same busy flag');
  await flush();
  release();
  await fromDataAndSync;
  assert.equal(shared.getSnapshot().message, 'Sync finished.');
});

test('the end at 90 s still stands with the steps in place', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shared = createSyncNowShared();
  const pending = shared.run(async (board) => {
    void board.step('Account views', () => new Promise(() => {}), 10 * SYNC_NOW_END_MS);
    await new Promise(() => {});
    return 'x';
  });
  t.mock.timers.tick(SYNC_NOW_END_MS);
  await pending;
  assert.equal(shared.getSnapshot().busy, false);
});

test('Allow: denied keeps the in-app answer, granted proceeds and says so, a partial grant names what is missing', () => {
  const denied = permissionAnswer({ granted: [], missing: ['Steps', 'HeartRate'] }, 'Health Connect');
  assert.equal(denied.needsPermission, true);
  assert.equal(denied.proceed, false);
  assert.match(denied.text, /^Not allowed\./);
  assert.equal(permissionAnswer(undefined, 'Health Connect').needsPermission, true);
  const granted = permissionAnswer({ granted: ['Steps'], missing: [] }, 'Health Connect');
  assert.deepEqual([granted.needsPermission, granted.proceed], [false, true]);
  assert.match(granted.text, /Allowed in Health Connect/);
  const partial = permissionAnswer({ granted: ['Steps'], missing: ['HeartRate'] }, 'Health Connect');
  assert.equal(partial.proceed, true);
  assert.match(partial.text, /Still missing: HeartRate/);
});
