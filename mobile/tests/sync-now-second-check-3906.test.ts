import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SyncBoard, syncNowRunner, waitingText } from '../src/core/sync/deadline.ts';
import { createSyncNowShared } from '../src/features/settings/data/sync-now-state.ts';
import { runSyncNow, type SyncNowDeps } from '../src/features/settings/data/sync-now-steps.ts';
import { pendingChanges } from '../src/features/settings/data/device-uploads.ts';

// #3906 second check: the result text of Sync now.
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};
function view() {
  const v = { busy: false, error: null as string | null, message: null as string | null };
  return {
    v,
    api: {
      setBusy: (b: boolean) => void (v.busy = b),
      setError: (e: string | null) => void (v.error = e),
      setMessage: (m: string | null) => void (v.message = m),
    },
  };
}

test('1: a "still running" tail follows its source after the run has ended, and clears when it does', async () => {
  const { v, api } = view();
  let status = 'running';
  const listeners = new Set<() => void>();
  const run = syncNowRunner(api);
  await run(async (board) => {
    board.also(() => (status === 'running' ? 'History download still running.' : null));
    board.watch((notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    });
    return 'Sync finished.';
  });
  assert.equal(v.message, 'Sync finished. History download still running.');
  status = 'complete';
  listeners.forEach((fn) => fn());
  assert.equal(v.message, 'Sync finished.', 'the tail is rebuilt, not frozen until the next tap');
  assert.equal(listeners.size, 0, 'and following stops once nothing is left');
});

test('1: a Health Connect tail clears the same way, and following continues while one is left', async () => {
  const { v, api } = view();
  const left = { download: true, import: true };
  const listeners = new Set<() => void>();
  await syncNowRunner(api)(async (board) => {
    board.also(() => (left.download ? 'History download still running.' : null));
    board.also(() => (left.import ? 'Health Connect import still reading.' : null));
    board.watch((notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    });
    return 'Sync finished.';
  });
  left.download = false;
  listeners.forEach((fn) => fn());
  assert.equal(v.message, 'Sync finished. Health Connect import still reading.');
  assert.equal(listeners.size, 1, 'still following');
  left.import = false;
  listeners.forEach((fn) => fn());
  assert.equal(v.message, 'Sync finished.');
});

test('2: a refused change is not worded as waiting, and only waiting rows "upload on their own"', () => {
  const text = waitingText([{ label: 'Training', reason: 'refused', refused: 1 }]);
  assert.equal(
    text,
    'Not everything uploaded. 1 Training change was refused by the server. Use Retry or Discard below.',
  );
  assert.doesNotMatch(text, /uploads on its own|Still waiting/);
  const mixed = waitingText([
    { label: 'Home', reason: 'offline' },
    { label: 'Workouts', reason: 'refused', refused: 2, what: 'workout' },
  ]);
  assert.match(mixed, /Still waiting: Home \(offline\)\. It is saved on this phone and uploads on its own\./);
  assert.match(mixed, /2 workout changes were refused by the server\. Use Retry or Discard below\.$/);
  assert.doesNotMatch(mixed, /use retry/);
});

// A minimal set of stores for runSyncNow.
function store(state: Record<string, unknown> = {}) {
  return { sync: async () => {}, refresh: async () => {}, getSnapshot: () => state };
}
function deps(over: Partial<SyncNowDeps> = {}): SyncNowDeps {
  return {
    health: store(),
    home: store(),
    nutrition: store(),
    training: store(),
    journal: { sync: async () => {}, getSnapshot: () => ({ data: { workouts: [] } }) },
    imported: { store: { getSnapshot: () => ({ error: null, enabled: true, pending: 0 }) }, refresh: async () => {} },
    activities: store(),
    history: store(),
    strap: { sync: () => {}, getSnapshot: () => ({ queued: 0 }) },
    scale: { sync: () => {}, getSnapshot: () => ({ queued: 0 }) },
    download: null,
    today: '2026-11-20',
    deviceHealthName: 'Health Connect',
    refreshWorkouts: () => {},
    refreshAccountViews: async () => {},
    ...over,
  };
}
const waitingAfter = async (d: SyncNowDeps) => {
  const board = new SyncBoard();
  await runSyncNow(board, d, false);
  return board.waiting();
};

test('5: "Sync finished" needs every store the sign-out sheet counts at zero; the rest are named', async () => {
  assert.deepEqual(await waitingAfter(deps()), []);
  const rows = await waitingAfter(
    deps({
      imported: { store: { getSnapshot: () => ({ error: null, enabled: true, pending: 3 }) }, refresh: async () => {} },
      strap: { sync: () => {}, getSnapshot: () => ({ queued: 5 }) },
      scale: { sync: () => {}, getSnapshot: () => ({ queued: 2 }) },
    }),
  );
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Health Connect', 'Strap and scale'],
  );
  assert.equal(rows[0].reason, '3 changes not uploaded yet');
  assert.equal(rows[1].reason, '3 changes not uploaded yet', 'one strap upload (5 samples) plus 2 weigh-ins');
});

test('5: the run\'s tally and the sheet\'s are one function', () => {
  const source = readFileSync(new URL('../src/features/settings/data/useNativeDataActions.ts', import.meta.url), 'utf8');
  assert.match(source, /pendingChanges\(/);
  const steps = readFileSync(new URL('../src/features/settings/data/sync-now-steps.ts', import.meta.url), 'utf8');
  assert.match(steps, /pendingBy\(/, 'Sync now reads the same tally the sheet shows');
  const sources = {
    health: { operations: [{}] },
    home: { operations: [] },
    nutrition: { operations: [{}], http: [{}] },
    training: { operations: [] },
    journal: { data: { workouts: [{ pending: [{}, {}] }] } },
    imported: { pending: 1 },
    activities: { pending: 1 },
    history: { operations: [{}] },
    devices: { strapSamples: 0, scaleReadings: 1 },
  };
  assert.equal(pendingChanges(sources), 9);
});

test('3: A\'s leftover text is not shown to B, and A\'s late emit changes nothing under B', async () => {
  const shared = createSyncNowShared();
  shared.setAccount('https://x|A');
  let release: (message: string) => void = () => {};
  const listeners = new Set<() => void>();
  let aLeft = true;
  void shared.run(async (board) => {
    board.also(() => (aLeft ? 'History download still running.' : null));
    board.watch((notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    });
    return new Promise<string>((resolve) => (release = resolve));
  });
  assert.equal(shared.getSnapshot().busy, true);
  shared.setAccount('https://x|B');
  assert.deepEqual(shared.getSnapshot(), { busy: false, error: null, message: null }, 'B sees nothing of A');
  release('Sync finished.');
  aLeft = false;
  listeners.forEach((fn) => fn());
  await flush();
  assert.deepEqual(shared.getSnapshot(), { busy: false, error: null, message: null }, 'A\'s run changes nothing under B');
});

test('3: after A\'s run ended with an error, a new session starts clean; the same account keeps it', async () => {
  const shared = createSyncNowShared();
  shared.setAccount('A');
  await shared.run(async (board) => {
    await board.step('Home', async () => {
      throw new Error('Offline.');
    });
    return 'Sync finished.';
  });
  assert.match(shared.getSnapshot().error ?? '', /Home \(offline\)/);
  shared.setAccount('A');
  assert.match(shared.getSnapshot().error ?? '', /Home/, 'the same account is not reset');
  shared.setAccount(null);
  assert.equal(shared.getSnapshot().error, null);
});

test('3: a tap under B while A\'s run is still alive starts B\'s own run', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shared = createSyncNowShared();
  shared.setAccount('A');
  let aStarted = 0,
    bStarted = 0;
  void shared.run(() => {
    aStarted++;
    return new Promise<string>(() => {});
  });
  shared.setAccount('B');
  await shared.run(async () => {
    bStarted++;
    return 'B done.';
  });
  assert.equal(aStarted, 1);
  assert.equal(bStarted, 1, 'B did not join A');
  assert.equal(shared.getSnapshot().message, 'B done.');
  assert.equal(shared.getSnapshot().busy, false);
});

test('3: the account change is wired to the app\'s data connection', () => {
  const source = readFileSync(new URL('../src/features/settings/data/HistoryDownloadProvider.tsx', import.meta.url), 'utf8');
  assert.match(source, /syncNowShared\.setAccount\(accountKey\)/);
  assert.match(source, /connection \? `\$\{connection\.origin\}\|\$\{connection\.userId\}` : null/);
});
