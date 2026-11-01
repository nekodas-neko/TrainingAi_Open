import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityStore,
  confirmedActivity,
  deadLettered,
  elapsedMs,
  sessionPayload,
} from '../src/features/activities/data/ActivityStore.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import { ApiError } from '../src/features/account/api/client.ts';
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
test('a paused guided walk saved early is cut at its active seconds, not the wall clock', async () => {
  const f = fixture(),
    store = f.create();
  await store.initialize();
  await store.start(type, {
    kind: 'walk',
    config: { ...defaultWalk, sets: 1, fastSec: 600, slowSec: 600, warmupSec: 0, cooldownSec: 0 },
    saved: false,
  });
  await store.begin();
  f.advance(120_000);
  await store.pause();
  f.advance(300_000);
  await store.pause();
  f.advance(60_000);
  await store.finishGuided();
  // 8 minutes by the wall clock, 3 of them walked.
  assert.equal(elapsedMs(store.getSnapshot().session!, f.now()), 180_000);
  await store.saveWalk('Australia/Brisbane');
  const { segments, durationMin } = store.getSnapshot().rows[0].payload;
  assert.equal(durationMin, 3);
  assert.equal(segments?.length, 1, 'the fast block was never reached');
  assert.equal(segments?.[0].endSec, 180, 'the slow block ends at the stop, not at 480 or 600');
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

test('same-minute canonical IDs are accepted only after complete field readback', () => {
  const payload = {
    id,
    date: '2026-10-12',
    activityType: 'treadmill',
    title: 'Walk',
    startTime: '12:00',
    durationMin: 20,
  };
  const canonical = { ...payload, id: '10000000-0000-4000-8000-000000000999' };
  assert.equal(confirmedActivity(payload, [canonical])?.id, canonical.id);
  assert.equal(confirmedActivity(payload, [{ ...canonical, activityType: 'run' }]), null);
  assert.equal(confirmedActivity(payload, [{ ...canonical, startTime: '12:01' }]), null);
});
test('JSONB property ordering cannot strand a guided-walk upload', () => {
  const payload = {
    id,
    date: '2026-10-12',
    activityType: 'walk',
    title: 'Interval walk',
    startTime: '12:00',
    segments: [
      {
        index: 0,
        setNumber: 1,
        kind: 'slow' as const,
        startSec: 0,
        endSec: 60,
        avgHr: null,
        maxHr: null,
        hrAtStart: null,
        avgPaceSecPerKm: null,
        distanceKm: null,
        avgCadenceSpm: null,
      },
    ],
  };
  const reversed = {
    ...payload,
    segments: payload.segments.map((segment) =>
      Object.fromEntries(Object.entries(segment).reverse()),
    ),
  };
  assert.equal(confirmedActivity(payload, [reversed])?.id, id);
});
const second = '10000000-0000-4000-8000-000000000002';
const record = (rowId: string, startTime: string) => ({
  id: rowId,
  date: '2026-10-12',
  activityType: 'treadmill',
  title: 'Treadmill',
  durationMin: 20,
  startTime,
  endTime: '12:20',
});
// The server refuses `rejectId` with a per-item error (HTTP 200, processed 0) and takes the rest.
async function rejecting(
  rejectId: string,
  error = 'Rejected by the sync schema at payload',
  retryable = false,
) {
  const f = fixture(),
    accept = f.connection.post;
  f.online();
  let refused = 0,
    down = false;
  f.connection.post = async (path, body) => {
    if (down) {
      throw new Error('Offline');
    }
    const change = (body as { mutations: { id: string; domain: string; date: string }[] })
      .mutations[0];
    if (change.id !== rejectId) {
      return accept(path, body);
    }
    refused++;
    return {
      processed: 0,
      errors: [{ id: change.id, domain: change.domain, date: change.date, error, retryable }],
    };
  };
  const store = f.create();
  await store.initialize();
  await store.saveRecord(record(id, '12:00'));
  await store.saveRecord(record(second, '12:30'));
  return { f, store, refused: () => refused, offline: (value: boolean) => (down = value) };
}
const pendingIds = (store: ActivityStore) =>
  store
    .getSnapshot()
    .rows.filter((row) => row.pending)
    .map((row) => row.payload.id);
test('a rejected first activity does not block the one behind it', async () => {
  const { store } = await rejecting(id);
  await store.sync();
  const rows = store.getSnapshot().rows;
  assert.equal(rows.find((row) => row.payload.id === id)!.pending, true);
  assert.equal(rows.find((row) => row.payload.id === id)!.rejected!.attempts, 1);
  assert.equal(rows.find((row) => row.payload.id === second)?.pending, false);
  assert.equal(store.getSnapshot().error, null);
});
test('a rejection keeps the server error, counts, backs off, and dead-letters after 5', async () => {
  const { f, store, refused } = await rejecting(id, 'Ownership check failed');
  await store.sync();
  const first = () => store.getSnapshot().rows.find((row) => row.payload.id === id)!;
  assert.equal(first().rejected!.error, 'Ownership check failed');
  assert.equal(first().rejected!.at, f.now());
  // Inside the backoff window the row is not tried again.
  await store.sync();
  assert.equal(refused(), 1);
  for (let attempt = 2; attempt <= 5; attempt++) {
    f.advance(2 * 60 * 60_000);
    await store.sync();
    assert.equal(first().rejected!.attempts, attempt);
  }
  assert.equal(deadLettered(first()), true);
  assert.equal(first().rejected!.retryAt, undefined);
  f.advance(24 * 60 * 60_000);
  await store.sync();
  assert.equal(refused(), 5);
  assert.equal(first().pending, true);
});
test('a lost connection is not counted against the row', async () => {
  const { f, store, offline } = await rejecting(id);
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].rejected!.attempts, 1);
  offline(true);
  for (let i = 0; i < 3; i++) {
    f.advance(2 * 60 * 60_000);
    await store.sync();
  }
  assert.equal(store.getSnapshot().rows[0].rejected!.attempts, 1);
  assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
});
test('the server reporting its own database down is not counted either', async () => {
  const { store } = await rejecting(id, 'Failed query', true);
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].rejected, undefined);
  assert.equal(store.getSnapshot().rows[0].pending, true);
  assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
});
test('a later success clears the rejection count', async () => {
  const { f, store } = await rejecting(id);
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].rejected!.attempts, 1);
  // The server now takes it (an update shipped, or the user edited the activity).
  const accepting = fixture();
  accepting.online();
  f.connection.post = accepting.connection.post;
  f.connection.get = accepting.connection.get;
  f.advance(2 * 60 * 60_000);
  await store.sync();
  const row = store.getSnapshot().rows.find((r) => r.payload.id === id)!;
  assert.equal(row.pending, false);
  assert.equal(row.rejected, undefined);
});
test('rejection counts and dead letters survive a restart', async () => {
  const { f, store } = await rejecting(id);
  await store.sync();
  for (let i = 0; i < 4; i++) {
    f.advance(2 * 60 * 60_000);
    await store.sync();
  }
  const reopened = f.create();
  await reopened.initialize();
  const row = reopened.getSnapshot().rows.find((r) => r.payload.id === id)!;
  assert.equal(row.rejected!.attempts, 5);
  assert.equal(row.rejected!.error, 'Rejected by the sync schema at payload');
  assert.equal(deadLettered(row), true);
  assert.equal(reopened.getSnapshot().rows.find((r) => r.payload.id === second)!.pending, false);
});
// --- Run queue, non-200 pushes, fitness tests, old blobs (#3179) ---
const runA = '20000000-0000-4000-8000-00000000000a';
const runB = '20000000-0000-4000-8000-00000000000b';
const runBody = (runId: string) => ({ id: runId, status: 'completed' as const });
const HOUR = 60 * 60_000;
function runFixture(patch: (path: string, body: unknown) => Promise<unknown>) {
  const f = fixture();
  f.online();
  const patched: string[] = [];
  f.connection.patch = async (path, body) => {
    patched.push((body as { id: string }).id);
    return patch(path, body);
  };
  return { f, patched, store: f.create() };
}
const accepted = async (_: string, body: unknown) => ({
  run: { ...(body as object), activityLogId: null, completedAs: null },
});
// `json` is whether the body was our own `{ error }`; an HTML page from a proxy is not.
const failing = (status: number, json = true) => async () => {
  throw new ApiError(status, undefined, undefined, undefined, json);
};
const runRow = (store: ActivityStore, runId: string) =>
  store.getSnapshot().runs.find((row) => row.payload.id === runId)!;

test('a run PATCH answering 404 five times is dead-lettered and the next run uploads', async () => {
  const { f, store, patched } = runFixture(async (path, body) =>
    (body as { id: string }).id === runA ? failing(404)() : accepted(path, body),
  );
  await store.initialize();
  await store.completeRun('2026-10-12', runBody(runA));
  await store.completeRun('2026-10-12', runBody(runB));
  await store.sync();
  assert.equal(runRow(store, runA).rejected!.attempts, 1);
  assert.equal(runRow(store, runB).pending, false);
  for (let attempt = 2; attempt <= 5; attempt++) {
    f.advance(2 * HOUR);
    await store.sync();
    assert.equal(runRow(store, runA).rejected!.attempts, attempt);
  }
  assert.equal(deadLettered(runRow(store, runA)), true);
  f.advance(24 * HOUR);
  await store.sync();
  assert.equal(patched.filter((runId) => runId === runA).length, 5);
  assert.equal(runRow(store, runA).pending, true);
});
test('a run PATCH answering 500 is never counted, retries, and the next run still uploads', async () => {
  const { f, store, patched } = runFixture(async (path, body) =>
    (body as { id: string }).id === runA ? failing(500)() : accepted(path, body),
  );
  await store.initialize();
  await store.completeRun('2026-10-12', runBody(runA));
  await store.completeRun('2026-10-12', runBody(runB));
  await store.sync();
  for (let i = 0; i < 6; i++) {
    f.advance(2 * HOUR);
    await store.sync();
  }
  assert.equal(runRow(store, runA).rejected, undefined);
  assert.equal(deadLettered(runRow(store, runA)), false);
  assert.equal(runRow(store, runA).pending, true);
  assert.equal(runRow(store, runB).pending, false);
  assert.equal(patched.filter((runId) => runId === runA).length >= 6, true);
  assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
});
test('a run that answers 404, or fails its readback, is counted and the next run uploads', async () => {
  for (const bad of [failing(404), async () => ({ run: { id: runA, status: 'skipped' } })]) {
    const { store } = runFixture(async (path, body) =>
      (body as { id: string }).id === runA ? bad() : accepted(path, body),
    );
    await store.initialize();
    await store.completeRun('2026-10-12', runBody(runA));
    await store.completeRun('2026-10-12', runBody(runB));
    await store.sync();
    await store.sync();
    assert.equal(runRow(store, runA).rejected!.attempts, 1);
    assert.equal(runRow(store, runB).pending, false);
  }
});
test('a proxy HTML 400 or 404 on a run PATCH is retried without counting', async () => {
  for (const status of [400, 404]) {
    const { f, store, patched } = runFixture(async (path, body) =>
      (body as { id: string }).id === runA ? failing(status, false)() : accepted(path, body),
    );
    await store.initialize();
    await store.completeRun('2026-10-12', runBody(runA));
    await store.completeRun('2026-10-12', runBody(runB));
    for (let i = 0; i < 7; i++) {
      await store.sync();
      f.advance(2 * HOUR);
    }
    assert.equal(runRow(store, runA).rejected, undefined);
    assert.equal(deadLettered(runRow(store, runA)), false);
    assert.equal(runRow(store, runA).pending, true);
    assert.equal(runRow(store, runB).pending, false);
    assert.equal(patched.filter((runId) => runId === runA).length >= 7, true);
  }
});
test('a JSON 400 on a run PATCH is counted against the item', async () => {
  const { f, store } = runFixture(async (path, body) =>
    (body as { id: string }).id === runA ? failing(400)() : accepted(path, body),
  );
  await store.initialize();
  await store.completeRun('2026-10-12', runBody(runA));
  for (let attempt = 1; attempt <= 5; attempt++) {
    await store.sync();
    f.advance(2 * HOUR);
  }
  assert.equal(runRow(store, runA).rejected!.attempts, 5);
  assert.equal(deadLettered(runRow(store, runA)), true);
});
test('a run PATCH answering 429 or 503, or a lost connection, is not counted', async () => {
  for (const bad of [
    failing(429),
    failing(503),
    async () => Promise.reject(new Error('Offline')),
  ]) {
    const { store } = runFixture(bad);
    await store.initialize();
    await store.completeRun('2026-10-12', runBody(runA));
    await store.sync();
    assert.equal(runRow(store, runA).rejected, undefined);
    assert.equal(runRow(store, runA).pending, true);
  }
});
test('a run completes while an activity backs off', async () => {
  const { f, store } = runFixture(accepted);
  f.connection.post = async (_, body) => {
    const change = (body as { mutations: { id: string; domain: string; date: string }[] })
      .mutations[0];
    return {
      processed: 0,
      errors: [{ id: change.id, domain: change.domain, date: change.date, error: 'No' }],
    };
  };
  await store.initialize();
  await store.saveRecord(record(id, '12:00'));
  await store.completeRun('2026-10-12', runBody(runA));
  await store.sync();
  assert.equal(store.getSnapshot().rows[0].rejected!.attempts, 1);
  assert.equal(runRow(store, runA).pending, false);
});

// A push the server answers with a non-200 status.
async function refusedWith(status: number, json = true) {
  const f = fixture();
  f.online();
  let calls = 0;
  const accept = f.connection.post;
  f.connection.post = async (path, body) => {
    const change = (body as { mutations: { id: string }[] }).mutations[0];
    if (change.id !== id) {
      return accept(path, body);
    }
    calls++;
    throw new ApiError(status, undefined, undefined, undefined, json);
  };
  const store = f.create();
  await store.initialize();
  await store.saveRecord(record(id, '12:00'));
  await store.saveRecord(record(second, '12:30'));
  await store.sync();
  return { store, calls: () => calls };
}
test('a 400 push is counted against the item and the next one uploads', async () => {
  const { store } = await refusedWith(400);
  const rows = store.getSnapshot().rows;
  assert.equal(rows.find((row) => row.payload.id === id)!.rejected!.attempts, 1);
  assert.match(rows.find((row) => row.payload.id === id)!.rejected!.error, /HTTP 400/);
  assert.equal(rows.find((row) => row.payload.id === second)!.pending, false);
});
test('every status our push route answers in JSON is counted against the item', async () => {
  for (const status of [400, 401, 403, 413]) {
    const { store, calls } = await refusedWith(status);
    const attempts = () => store.getSnapshot().rows.find((row) => row.payload.id === id)!;
    assert.equal(attempts().rejected!.attempts, 1);
    assert.equal(calls(), 1);
  }
});
test('a proxy 4xx on a push is not counted and retries', async () => {
  for (const status of [400, 404]) {
    const { store, calls } = await refusedWith(status, false);
    const row = () => store.getSnapshot().rows.find((r) => r.payload.id === id)!;
    assert.equal(row().rejected, undefined);
    assert.equal(row().pending, true);
    const before = calls();
    for (let i = 0; i < 7; i++) {
      await store.sync();
    }
    assert.equal(row().rejected, undefined);
    assert.equal(deadLettered(row()), false);
    assert.equal(calls() >= before + 7, true);
  }
});
test('a 429 or a 5xx push is not counted and retries', async () => {
  for (const status of [429, 503]) {
    const { store } = await refusedWith(status);
    assert.equal(
      store.getSnapshot().rows.find((row) => row.payload.id === id)!.rejected,
      undefined,
    );
    assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
  }
});

test('a fitness test the server rejects is counted and dead-lettered after 5', async () => {
  const f = fixture();
  f.online();
  const stored: object[] = [];
  f.connection.get = async (_, query) => ({ date: query!.date, activityLogs: stored });
  let refused = 0;
  f.connection.post = async (_path, body) => {
    const change = (body as { mutations: { id: string; domain: string; date: string }[] })
      .mutations[0];
    if (change.domain !== 'fitness_tests') {
      // The fixture's server blanks the distance, which this test's effort row would fail on.
      stored.push({ ...(change as unknown as { payload: object }).payload });
      return { processed: 1, errors: [] };
    }
    refused++;
    return {
      processed: 0,
      errors: [{ id: change.id, domain: change.domain, date: change.date, error: 'Bad test' }],
    };
  };
  const store = f.create();
  await store.initialize();
  await store.start(
    { id: 'run', label: 'Run', icon: 'PersonSimpleRun', isDistanceBased: true },
    {
      kind: 'test',
      protocol: 'cooper12',
      activityId: second,
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
  const test0 = () => store.getSnapshot().tests[0];
  assert.equal(test0().rejected!.attempts, 1);
  assert.equal(store.getSnapshot().rows[0].pending, false);
  for (let attempt = 2; attempt <= 5; attempt++) {
    f.advance(2 * HOUR);
    await store.sync();
  }
  assert.equal(deadLettered(test0()), true);
  assert.equal(test0().rejected!.error, 'Bad test');
  f.advance(24 * HOUR);
  await store.sync();
  assert.equal(refused, 5);
});

test('a blob stored before rejections existed, without `rejected`, loads and uploads', async () => {
  const f = fixture();
  f.online();
  const store = f.create();
  await store.initialize();
  await store.saveRecord(record(id, '12:00'));
  const [key] = [...f.values.keys()];
  const blob = JSON.parse(f.values.get(key)!);
  blob.rows = blob.rows.map(({ rejected: _, ...row }: Record<string, unknown>) => ({
    ...row,
    pending: true,
  }));
  blob.runs = [{ date: '2026-10-12', payload: runBody(runA), pending: true }];
  blob.tests = [];
  f.values.set(key, JSON.stringify(blob));
  f.connection.patch = accepted;
  const reopened = f.create();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().rows[0].rejected, undefined);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().rows[0].pending, false);
  assert.equal(runRow(reopened, runA).pending, false);
});
