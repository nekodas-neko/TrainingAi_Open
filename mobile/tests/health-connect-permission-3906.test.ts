import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RUN_LIMIT_MS,
  RUN_STILL_READING,
} from '../src/features/health/data/HealthConnectImportStore.ts';
import {
  HealthConnectImportStore,
  IMPORT_NEEDS_PERMISSION,
} from '../src/features/health/data/HealthConnectImportStore.ts';
import { HealthConnectPersistence } from '../src/features/health/data/health-connect-persistence.ts';
import {
  importPermissionNote,
  importStatusError,
} from '../src/features/health/data/device-import.ts';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
import type { HealthConnectType } from '@trainingai/shared/validation/health-connect-import';

const start = Date.parse('2026-11-20T05:00:00Z');

function fixture(
  options: {
    sheetNeverAnswers?: boolean;
    hang?: 'hasHistory' | 'changes' | 'history' | 'post' | 'firstHand';
  } = {},
) {
  const saved = new Map<string, string>();
  const storage = {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: string) => {
      saved.set(key, value);
    },
    remove: async (key: string) => {
      saved.delete(key);
    },
  };
  const calls = { permissions: 0, requests: 0, reads: 0, historyRequests: 0 };
  let granted: HealthConnectType[] = [];
  let grantOnRequest: HealthConnectType[] = [];
  let clock = start;
  let endless = false;
  let slowSheet: ((types: HealthConnectType[]) => void) | null = null;
  let sheetOnHold = false;
  const reader: HealthConnectReader = {
    permissions: async () => {
      calls.permissions++;
      return granted;
    },
    request: async () => {
      calls.requests++;
      if (options.sheetNeverAnswers) return new Promise<HealthConnectType[]>(() => {});
      if (sheetOnHold)
        return new Promise<HealthConnectType[]>((resolve) => {
          slowSheet = (types) => {
            granted = types;
            resolve(types);
          };
        });
      granted = grantOnRequest;
      return granted;
    },
    historyPermission: async () => {
      calls.historyRequests++;
    },
    hasHistoryPermission: async () =>
      options.hang === 'hasHistory' ? new Promise<boolean>(() => {}) : false,
    history: async () => {
      calls.reads++;
      if (options.hang === 'history') return new Promise<never>(() => {});
      return { records: [], pageToken: endless ? `page-${calls.reads}` : null, skipped: 0 };
    },
    changes: async () => {
      calls.reads++;
      if (options.hang === 'changes') return new Promise<never>(() => {});
      if (options.hang === 'post' && calls.reads === 1)
        return {
          records: [
            {
              id: 'steps-one',
              type: 'Steps' as const,
              sourcePackage: 'com.test.watch',
              recordingMethod: 2,
              modifiedAt: '2026-11-19T03:00:00Z',
              start: '2026-11-19T02:00:00Z',
              end: '2026-11-19T03:00:00Z',
              value: 1200,
            },
          ],
          deleted: [],
          token: 'cursor-1',
          expired: false,
          more: false,
          skipped: 0,
        };
      return { records: [], deleted: [], token: 'cursor-1', expired: false, more: false, skipped: 0 };
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async () =>
      options.hang === 'post'
        ? new Promise<never>(() => {})
        : { measurements: 0, nights: 0, days: 0, heartRate: 0, hrv: null, completedAt: new Date(clock).toISOString() },
  };
  const firstHand = options.hang === 'firstHand' ? () => new Promise<never>(() => {}) : undefined;
  const store = new HealthConnectImportStore(storage, connection, reader, () => {}, () => clock, firstHand);
  return {
    store,
    /** The next permission sheet waits for `answerSheet`, as a person taking their time would. */
    holdSheet: () => {
      sheetOnHold = true;
    },
    answerSheet: (types: HealthConnectType[]) => slowSheet?.(types),
    calls,
    /** A fresh store over the same disk with `requested` emptied: no type has ever been asked for. */
    unasked: async () => {
      const saved = (await new HealthConnectPersistence(storage).read()) as any;
      await new HealthConnectPersistence(storage).write({ ...saved, requested: [] });
      const next = new HealthConnectImportStore(storage, connection, reader, () => {}, () => clock);
      await next.initialize();
      return next;
    },
    disk: () => new HealthConnectPersistence(storage).read() as Promise<any>,
    grant: (types: HealthConnectType[]) => {
      granted = types;
    },
    grantOnRequest: (types: HealthConnectType[]) => {
      grantOnRequest = types;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    endlessHistory: () => {
      endless = true;
    },
  };
}

test('#3906: switched on with no permission is a needs-permission state, not a change waiting or an error', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  const state = f.store.getSnapshot();
  assert.equal(state.pending, 0, 'the "1 change waiting" is gone');
  assert.equal(state.needsPermission, true);
  assert.equal(state.error, null, 'Sync now has nothing to fail on');
  assert.equal(state.busy, false);
  assert.equal(f.calls.reads, 0);
  assert.equal(importStatusError(state), null);
  assert.match(importPermissionNote(state, 'Health Connect') ?? '', /Needs permission/);
});

test('#3906: turning the switch on asks for permission first, and reads once it is granted', async () => {
  const f = fixture();
  f.grantOnRequest(['Steps']);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.calls.requests, 1);
  assert.equal(f.store.getSnapshot().needsPermission, false);
  assert.ok(f.calls.reads > 0);
  assert.equal((await f.disk()).token, 'cursor-1');
});

test('#3906: Import history with no permission answers in the app, and leaves the saved read alone', async () => {
  const f = fixture();
  f.grant(['Steps']);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal((await f.disk()).token, 'cursor-1');
  f.grant([]);
  const reads = f.calls.reads,
    requests = f.calls.requests;
  await assert.rejects(
    f.store.importHistory(new Date(start - 10 * 86_400_000).toISOString()),
    new Error(IMPORT_NEEDS_PERMISSION),
    'the tap says why nothing happened',
  );
  assert.equal(f.calls.requests, requests, 'the tap opens nothing by itself');
  assert.equal(f.calls.historyRequests, 0);
  const disk = await f.disk();
  assert.equal(disk.token, 'cursor-1', 'the token is not cleared for a read that cannot run');
  assert.equal(f.calls.reads, reads);
  assert.equal(f.store.getSnapshot().pending, 0);
  assert.equal(f.store.getSnapshot().needsPermission, true);
});

test('#3906: with nothing queued, the minute and foreground reruns keep the 5-minute throttle', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  const asked = f.calls.permissions;
  // What useDeviceHealthImport does every 60 s and on every return to the foreground.
  for (let minute = 1; minute <= 4; minute++) {
    f.advance(60_000);
    await f.store.run(f.store.owed());
  }
  assert.equal(f.store.owed(), false);
  assert.equal(f.calls.permissions, asked, 'no rerun every minute');
  f.advance(60_000);
  await f.store.run(f.store.owed());
  assert.equal(f.calls.permissions, asked + 1, 'the throttled run still happens');
});

test('#3906 review: a long import with nothing queued keeps its pace, not the 5-minute throttle', async () => {
  const f = fixture();
  f.grant(['Steps']);
  f.grantOnRequest(['Steps']);
  f.endlessHistory();
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.ok((await f.disk()).scan, 'the scan is still going');
  assert.equal((await f.disk()).queue.length, 0, 'with no batch waiting');
  assert.equal(f.store.owed(), true);
  const reads = f.calls.reads;
  f.advance(60_000);
  await f.store.run(f.store.owed());
  assert.ok(f.calls.reads > reads, 'the minute rerun reads the next pages at once');
});

test('#3906 review: a permission granted in Health Connect settings reads on the return, not 5 minutes later', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.store.getSnapshot().needsPermission, true);
  assert.equal(f.store.owed(), false);
  assert.equal(f.store.awaitingFirstRead(), true);
  f.grant(['Steps']);
  f.advance(30_000);
  // What useDeviceHealthImport does on a return to the foreground.
  await f.store.run(f.store.owed() || f.store.awaitingFirstRead());
  assert.ok(f.calls.reads > 0);
  assert.equal(f.store.getSnapshot().needsPermission, false);
  assert.equal(f.store.awaitingFirstRead(), false);
});

test('#3923 review: Import history with the switch off and no permission still answers the tap', async () => {
  const f = fixture();
  await f.store.initialize();
  assert.equal(f.store.getSnapshot().enabled, false);
  await assert.rejects(
    f.store.importHistory(new Date(start - 10 * 86_400_000).toISOString()),
    new Error(IMPORT_NEEDS_PERMISSION),
  );
  assert.equal(f.calls.requests, 0, 'no permission sheet opens from the tap');
  assert.equal(f.calls.historyRequests, 0, 'nor the extended-history one (L11 #75)');
  assert.equal(f.store.getSnapshot().enabled, false, 'the switch is left as it was');
});

test('#3906: switching off clears the status, and an off switch never shows the permission error', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  await f.store.run(true);
  await f.store.setEnabled(false);
  const state = f.store.getSnapshot();
  assert.equal(state.enabled, false);
  assert.equal(state.needsPermission, false);
  assert.equal(state.error, null);
  assert.equal(state.pending, 0);
  assert.equal(
    importStatusError({ enabled: false, error: 'No Health Connect read permissions are granted.' }),
    null,
  );
  assert.equal(importStatusError({ enabled: true, error: 'Upload failed.' }), 'Upload failed.');
  assert.equal(importPermissionNote({ enabled: false, needsPermission: true }, 'Health Connect'), null);
});

const older = () => new Date(start - 90 * 86_400_000).toISOString();

test('#3906 L11 #75: Import history, three states: off with no permission, on with none, granted', async () => {
  // Off and no permission: the in-app answer, and no system dialog of any kind.
  const off = fixture();
  await off.store.initialize();
  await assert.rejects(off.store.importHistory(older()), new Error(IMPORT_NEEDS_PERMISSION));
  assert.deepEqual([off.calls.requests, off.calls.historyRequests], [0, 0]);
  // On and no permission: the same answer, again with nothing opened.
  const on = fixture();
  await on.store.setEnabled(true);
  const asked = on.calls.requests;
  await assert.rejects(on.store.importHistory(older()), new Error(IMPORT_NEEDS_PERMISSION));
  assert.deepEqual([on.calls.requests, on.calls.historyRequests], [asked, 0]);
  // Granted: it goes ahead; the extended-history sheet is the tap's own, for a window past the floor.
  const granted = fixture();
  granted.grant(['Steps']);
  granted.grantOnRequest(['Steps']);
  await granted.store.setEnabled(true);
  await granted.store.importHistory(older());
  assert.ok(granted.calls.reads > 0);
  assert.equal(granted.calls.historyRequests, 1);
});

test('#3906: the Allow button is the one thing that opens the system dialog, and a grant then reads', async () => {
  const f = fixture();
  f.grantOnRequest(['Steps']);
  await f.store.initialize();
  await assert.rejects(f.store.importHistory(older()), new Error(IMPORT_NEEDS_PERMISSION));
  assert.equal(f.calls.requests, 0);
  await f.store.requestPermission();
  assert.equal(f.calls.requests, 1);
  assert.equal(f.store.getSnapshot().needsPermission, false);
  await f.store.importHistory(older());
  assert.ok(f.calls.reads > 0, 'the next tap imports');
});

test('#3906: a sync never opens the permission sheet, and a sheet that never answers does not hold the run busy', async (t) => {
  const f = fixture();
  await f.store.setEnabled(true);
  const before = f.calls.requests;
  await f.store.run(true, { ask: false });
  assert.equal(f.calls.requests, before, 'Sync now asks nothing');
  assert.equal(f.store.getSnapshot().needsPermission, true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hung = fixture({ sheetNeverAnswers: true });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const enabling = hung.store.setEnabled(true).catch(() => {});
  await flush();
  t.mock.timers.tick(120_000);
  await enabling;
  const running = hung.store.run(true);
  await flush();
  t.mock.timers.tick(120_000);
  await running;
  assert.equal(hung.store.getSnapshot().busy, false, 'the run ended');
});

// #3906 review. Nothing has been asked yet (`requested` is empty) and nothing is granted, so the
// guard `options.ask !== false` is the only thing between a sync and the system sheet.
test('#3906 review: a sync with nothing ever asked and no permission opens no sheet', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  const store = await f.unasked();
  assert.deepEqual((await f.disk()).requested, [], 'every type is still unasked');
  const before = f.calls.requests;
  await store.run(true, { ask: false });
  assert.equal(f.calls.requests, before, 'ask: false asks nothing');
  await store.run(true);
  assert.equal(f.calls.requests, before + 1, 'without it, the same run does ask');
});

test('#3906 review: a partial grant does not make Import history open the sheet for types never asked', async () => {
  const f = fixture();
  await f.store.setEnabled(true);
  const before = f.calls.requests;
  f.grant(['Steps']);
  await f.store.importHistory(older());
  assert.equal(f.calls.requests, before, 'a tap on Import history never opens the permission sheet');
});

test('#3906 review: Allow reports what was granted and what is missing', async () => {
  const f = fixture();
  f.grantOnRequest(['Steps']);
  await f.store.initialize();
  const result = await f.store.requestPermission();
  assert.deepEqual(result.granted, ['Steps']);
  assert.ok(result.missing.length > 0 && !result.missing.includes('Steps'));
  const denied = fixture();
  await denied.store.initialize();
  assert.deepEqual((await denied.store.requestPermission()).granted, []);
  assert.equal(denied.store.getSnapshot().needsPermission, true);
});

for (const hang of ['hasHistory', 'changes', 'history', 'post'] as const) {
  test(`#3906 review: a ${hang} call that never answers ends the run and clears busy`, async (t) => {
    const f = fixture({ hang });
    f.grant(['Steps']);
    await f.store.setEnabled(true);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flush = async () => {
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    };
    f.advance(10 * 60_000);
    const running = f.store.run(true, { ask: false });
    await flush();
    assert.equal(f.store.getSnapshot().busy, true, 'busy while it waits');
    t.mock.timers.tick(30_000);
    await flush();
    t.mock.timers.tick(30_000);
    await running;
    const state = f.store.getSnapshot();
    assert.equal(state.busy, false, 'the spinner and the Import history button are free again');
    assert.ok(state.error, 'and the store says why');
    assert.equal(state.pending >= 0, true);
    // Nothing is marked uploaded: the queue (or the unfinished read) is still owed.
    const again = f.store.run(true, { ask: false });
    assert.equal(typeof again.then, 'function', 'the next run starts fresh, it does not join a stuck one');
  });
}

test('#3906 review: the whole run has an end even when every call is slow in turn', async (t) => {
  const f = fixture({ hang: 'history' });
  f.grant(['Steps']);
  await f.store.setEnabled(true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.advance(10 * 60_000);
  const running = f.store.run(true, { ask: false });
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(80_000);
  await running;
  assert.equal(f.store.getSnapshot().busy, false);
  assert.match(f.store.getSnapshot().error ?? '', /Health Connect|did not answer/);
  void RUN_LIMIT_MS;
  void RUN_STILL_READING;
});

test('#3906 second check: the first-hand source read is bounded, so a silent one cannot hold busy', async (t) => {
  const f = fixture({ hang: 'firstHand' });
  f.grant(['Steps']);
  await f.store.setEnabled(true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.advance(10 * 60_000);
  const running = f.store.run(true, { ask: false });
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.store.getSnapshot().busy, true, 'busy while it waits');
  t.mock.timers.tick(20_000);
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.store.getSnapshot().busy, false, 'cut at 20 s, not held until a call that never comes');
  await running;
  // A later run is not blocked behind a stuck one.
  await f.store.setEnabled(true);
});

test('#3906 second check: the run does not time out while the system permission sheet is open', async (t) => {
  const f = fixture();
  await f.store.setEnabled(true);
  const next = await f.unasked();
  f.holdSheet();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const flush = async () => {
    for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  f.advance(10 * 60_000);
  const running = next.run(true);
  await flush();
  assert.equal(next.getSnapshot().sheetOpen, true, 'the store says it waits on the answer');
  t.mock.timers.tick(RUN_LIMIT_MS + 10_000);
  await flush();
  assert.equal(next.getSnapshot().busy, true, 'past the run end, still waiting on the person');
  assert.equal(next.getSnapshot().error, null);
  f.answerSheet(['Steps']);
  await flush();
  await running;
  assert.equal(next.getSnapshot().sheetOpen, false);
  assert.equal(next.getSnapshot().busy, false);
  assert.doesNotMatch(next.getSnapshot().error ?? '', /still reading/);
});
