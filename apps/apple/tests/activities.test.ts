import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityStore,
  elapsedMs,
  sessionPayload,
} from '../src/features/activities/data/ActivityStore.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
const type = {
  id: 'treadmill',
  label: 'Treadmill',
  icon: 'PersonSimpleWalk',
  isDistanceBased: false,
};
const id = '10000000-0000-4000-8000-000000000001';
function fixture() {
  const values = new Map<string, string>();
  let now = Date.parse('2026-10-12T23:55:00+10:00'),
    online = false,
    mismatch = false;
  const server = new Map<string, unknown>();
  const requests: unknown[] = [];
  const connection: AccountConnection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (_, query) => ({ date: query!.date, activityLogs: [...server.values()] }),
    post: async (_, body) => {
      if (!online) {
        throw new Error('Offline');
      }
      const change = (body as { mutations: { payload: { id: string; durationMin: number } }[] })
        .mutations[0];
      requests.push(change);
      server.set(change.payload.id, {
        ...change.payload,
        durationMin: mismatch ? 999 : change.payload.durationMin,
        distanceKm: null,
        notes: null,
      });
      return { processed: 1, errors: [] };
    },
  };
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
  const create = (reader = connection) =>
    new ActivityStore(
      storage,
      reader,
      () => id,
      () => {},
      () => now,
    );
  return {
    create,
    values,
    storage,
    connection,
    requests,
    advance: (ms: number) => {
      now += ms;
    },
    online: () => {
      online = true;
    },
    mismatch: () => {
      mismatch = true;
    },
    now: () => now,
  };
}
test('activity pause and reload retain elapsed time without counting paused minutes', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(60_000);
  await store.pause();
  f.advance(180_000);
  const reopened = f.create();
  await reopened.initialize();
  assert.equal(elapsedMs(reopened.getSnapshot().session!, f.now()), 60_000);
  await reopened.pause();
  f.advance(120_000);
  await reopened.finish();
  const payload = sessionPayload(reopened.getSnapshot().session!, 'Australia/Brisbane');
  assert.equal(payload.durationMin, 3);
  assert.equal(payload.date, '2026-10-12');
  assert.equal(payload.endTime, '00:01');
});
test('offline save atomically clears the session and restores the same pending ID', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(600_000);
  await store.finish();
  await store.save('Australia/Brisbane');
  await store.sync();
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().rows[0].pending, true);
  const reopened = f.create();
  await reopened.initialize();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().rows[0].payload.id, id);
  f.online();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().rows[0].pending, false);
  await reopened.reconcile([id]);
  assert.equal(reopened.getSnapshot().rows.length, 0);
});
test('mismatched server readback keeps the activity pending', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(60_000);
  await store.finish();
  await store.save('Australia/Brisbane');
  await store.sync();
  f.online();
  f.mismatch();
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].pending, true);
});
test('invalid distance keeps the summary and does not queue a mutation', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(60_000);
  await store.finish();
  await store.update({ distance: '-1' });
  await assert.rejects(store.save('Australia/Brisbane'));
  assert.equal(store.getSnapshot().session?.mode, 'done');
  assert.equal(store.getSnapshot().rows.length, 0);
});
test('failed disk writes preserve the active recording', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(60_000);
  await store.finish();
  f.storage.set = async () => {
    throw new Error('Disk failure');
  };
  await assert.rejects(store.save('Australia/Brisbane'));
  assert.equal(store.getSnapshot().session?.id, id);
});
test('saved activities cannot be opened under another account', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  const other = f.create({ ...f.connection, userId: 'two' });
  await other.initialize();
  assert.equal(other.getSnapshot().ready, false);
  assert.equal(other.getSnapshot().session, null);
});
test('an existing activity cannot be silently replaced', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await assert.rejects(store.start({ ...type, id: 'cycle' }));
  assert.equal(store.getSnapshot().session?.type.id, 'treadmill');
});
test('finishing while paused excludes the final pause, and missing sensors stay absent', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(1_000);
  await store.pause();
  f.advance(100_000);
  await store.finish();
  await store.save('Australia/Brisbane');
  await store.sync();
  const payload = store.getSnapshot().rows[0].payload;
  assert.equal(payload.durationMin, 0);
  assert.equal(payload.avgHr, undefined);
  assert.equal(payload.distanceKm, undefined);
});

import {
  defaultWalk,
  walkPlan,
  fitnessResult,
} from '../src/features/activities/data/guidance.ts';
test('guided walk saves actual segments once across summary reopening', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type, {
    kind: 'walk',
    config: { ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60 },
    saved: false,
  });
  await store.begin();
  f.advance(90_000);
  await store.finishGuided();
  await store.saveWalk('Australia/Brisbane');
  await store.sync();
  const row = store.getSnapshot().rows[0];
  assert.equal(row.payload.durationMin, 1.5);
  assert.equal(row.payload.segments?.length, 2);
  assert.equal(row.payload.segments?.[1].endSec, 90);
  assert.equal(row.payload.segments?.[1].avgHr, null);
  const reopened = f.create();
  await reopened.initialize();
  await reopened.saveWalk('Australia/Brisbane');
  assert.equal(reopened.getSnapshot().rows.length, 1);
});
test('short guided walk cannot enter the upload queue', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type, { kind: 'walk', config: defaultWalk, saved: false });
  await store.begin();
  f.advance(30_000);
  await store.finishGuided();
  await assert.rejects(store.saveWalk('Australia/Brisbane'));
  assert.equal(store.getSnapshot().rows.length, 0);
});
test('guided timer clamps a late foreground finish to the planned window', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type, {
    kind: 'walk',
    config: { ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60 },
    saved: false,
  });
  await store.begin();
  f.advance(600_000);
  await store.finishGuided();
  assert.equal(elapsedMs(store.getSnapshot().session!, f.now()), 120_000);
});
test('fitness test and associated effort are saved atomically with stable IDs', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(
    { id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: true },
    {
      kind: 'test',
      protocol: 'cooper12',
      activityId: '10000000-0000-4000-8000-000000000002',
      countdownUntil: f.now(),
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  );
  await store.begin();
  f.advance(720_000);
  await store.update({ distance: '2.4' });
  await store.finishGuided();
  await store.saveFitness('Australia/Brisbane', {});
  await store.sync();
  assert.equal(store.getSnapshot().tests[0].payload.vo2maxEst, 42.4);
  assert.equal(store.getSnapshot().rows[0].payload.durationMin, 12);
  assert.equal(store.getSnapshot().session, null);
  const reopened = f.create();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().tests[0].payload.id, id);
  assert.equal(
    reopened.getSnapshot().rows[0].payload.id,
    '10000000-0000-4000-8000-000000000002',
  );
});
test('early and missing-distance tests save effort without scoring fitness', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(
    { id: 'walk', label: 'Walk', icon: 'PersonSimpleWalk', isDistanceBased: true },
    {
      kind: 'test',
      protocol: '6mwt',
      activityId: '10000000-0000-4000-8000-000000000002',
      countdownUntil: f.now(),
      restingHr: '',
      peakHr: '',
      recoveryHr: '',
      saved: false,
    },
  );
  await store.begin();
  f.advance(60_000);
  await store.finishGuided();
  const result = fitnessResult(store.getSnapshot().session!, 'Australia/Brisbane', {});
  assert.equal(result.early, true);
  assert.equal(result.payload.vo2maxEst, undefined);
  assert.equal(result.activity?.durationMin, 1);
});
test('manual HR recovery preserves absent readings rather than zero', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type, {
    kind: 'test',
    protocol: 'resting_hrr',
    activityId: '10000000-0000-4000-8000-000000000002',
    countdownUntil: f.now(),
    restingHr: '',
    peakHr: '',
    recoveryHr: '',
    saved: false,
  });
  await store.begin();
  f.advance(180_000);
  await store.finishGuided();
  const result = fitnessResult(store.getSnapshot().session!, 'Australia/Brisbane', {});
  assert.equal(result.payload.hrr1Bpm, undefined);
  assert.equal(result.payload.restingHr, undefined);
  assert.equal(result.activity, null);
});
test('an edit made while uploading is not acknowledged by the older write', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type);
  await store.begin();
  f.advance(60_000);
  await store.finish();
  await store.save('Australia/Brisbane');
  await store.sync();
  const old = store.getSnapshot().rows[0].payload;
  let resolve!: () => void;
  f.online();
  const original = f.connection.post;
  f.connection.post = async (path, body) => {
    await new Promise<void>((r) => {
      resolve = r;
    });
    f.connection.post = original;
    return original(path, body);
  };
  const upload = store.sync();
  while (!resolve) {
    await new Promise((r) => setImmediate(r));
  }
  await store.saveRecord({ ...old, title: 'Edited title' });
  resolve();
  await upload;
  assert.equal(store.getSnapshot().rows[0].payload.title, 'Edited title');
  assert.equal(store.getSnapshot().rows[0].pending, false);
  assert.equal(f.requests.length, 2);
});
