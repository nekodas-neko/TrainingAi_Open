import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HealthStore,
  overlayBody,
  overlaySleep,
} from '../src/features/health/data/HealthStore.ts';
import { bodySpec, sleepSchema } from '../src/features/health/data/models.ts';
import { manualNightWindow } from '../src/features/health/data/manual-night.ts';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { ApiError } from '../src/features/account/api/client.ts';

const date = '2026-10-10';
const now = Date.parse('2026-10-10T12:00:00Z');
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const records = new Map<string, string>();
  const storage = {
    get: async (key: string) => records.get(key) ?? null,
    set: async (key: string, value: string) => {
      records.set(key, value);
    },
    remove: async (key: string) => {
      records.delete(key);
    },
  };
  let sequence = 1;
  let body = bodySpec(date).schema.parse({
    today: {
      date,
      weightKg: 80,
      bodyFat: 20,
      bodyFatCorrected: 22,
      bodyFatIsCorrected: true,
      waterMl: 1000,
    },
    recent: [
      {
        date,
        weightKg: 80,
        bodyFat: 20,
        bodyFatCorrected: 22,
        bodyFatIsCorrected: true,
        waterMl: 1000,
      },
    ],
    latestWeightKg: 80,
    latestWeightDate: date,
  });
  let online = true;
  let failRead = false;
  let loseReply = false;
  const applied = new Set<string>();
  const mutations: { id: string; payload: Record<string, number> }[] = [];
  const verdicts: unknown[] = [];
  const readinessAnswers: unknown[] = [];
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string): Promise<unknown> => {
      if (!online || failRead) {
        throw new Error('offline');
      }
      return path === '/api/body-metadata' ? body : [];
    },
    post: async (path: string, envelope: unknown) => {
      if (!online) {
        throw new Error('offline');
      }
      if (path === '/api/readiness-verdict') {
        readinessAnswers.push(envelope);
        return { ok: true };
      }
      if (path === '/api/sleep-verdict') {
        verdicts.push(envelope);
        return { ok: true };
      }
      const mutation = (
        envelope as { mutations: { id: string; payload: Record<string, number> }[] }
      ).mutations[0];
      mutations.push(mutation);
      if (!applied.has(mutation.id)) {
        applied.add(mutation.id);
        const p = mutation.payload;
        if (p.waterMlDelta) {
          body = {
            ...body,
            today: { ...body.today!, waterMl: body.today!.waterMl! + p.waterMlDelta },
            recent: [{ ...body.recent[0], waterMl: body.recent[0].waterMl! + p.waterMlDelta }],
          };
        }
        if (p.weightKg) {
          body = {
            ...body,
            latestWeightKg: p.weightKg,
            today: { ...body.today!, weightKg: p.weightKg },
            recent: [{ ...body.recent[0], weightKg: p.weightKg }],
          };
        }
      }
      if (loseReply) {
        loseReply = false;
        throw new Error('response lost');
      }
      return { processed: 1, errors: [] };
    },
  };
  const store = () =>
    new HealthStore(
      storage,
      connection,
      () => id(sequence++),
      () => {},
      () => now,
    );
  return {
    store,
    connection,
    storage,
    mutations,
    verdicts,
    readinessAnswers,
    setOnline: (value: boolean) => {
      online = value;
    },
    setReadFailure: (value: boolean) => {
      failRead = value;
    },
    loseReply: () => {
      loseReply = true;
    },
  };
}
test('offline body writes survive SQLite reopening and preserve unrelated raw measurements', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const local = await createLocalStorage(db.database);
  const f = fixture();
  const scope = local.account(f.connection.origin, f.connection.userId);
  const first = new HealthStore(
    scope,
    f.connection,
    () => id(1),
    () => {},
    () => now,
  );
  await first.refresh();
  f.setOnline(false);
  await first.logMetric('bodyFat', 21, date);
  await first.sync();
  first.cancel();
  const second = new HealthStore(
    scope,
    f.connection,
    () => id(2),
    () => {},
    () => now,
  );
  await second.initialize();
  const body = overlayBody(second.getSnapshot().body, second.getSnapshot().operations, date)!;
  assert.equal(body.today!.weightKg, 80);
  assert.equal(body.today!.bodyFat, 21);
  assert.equal(body.today!.bodyFatCorrected, null);
  assert.equal(body.today!.bodyFatIsCorrected, false);
  assert.equal(second.getSnapshot().operations[0].payload.bodyFatPct, 21);
  assert.equal(second.getSnapshot().operations[0].payload.weightKg, undefined);
});
test('water retries use the same identity after a lost reply and do not double count', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.loseReply();
  await store.addWater(250, date);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 1);
  await store.refresh(true);
  assert.equal(
    overlayBody(store.getSnapshot().body, store.getSnapshot().operations, date)!.today!.waterMl,
    1250,
  );
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.getSnapshot().body!.today!.waterMl, 1250);
  assert.equal(f.mutations[0].id, f.mutations[1].id);
});
test('an acknowledged write stays visible until readback and is not posted twice', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setReadFailure(true);
  await store.logMetric('weightKg', 81, date);
  await store.sync();
  assert.equal(store.getSnapshot().operations[0].acknowledged, true);
  assert.equal(
    overlayBody(store.getSnapshot().body, store.getSnapshot().operations, date)!.today!
      .weightKg,
    81,
  );
  f.setReadFailure(false);
  await store.sync();
  assert.equal(f.mutations.length, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
});
test('a local disk failure cannot claim a saved entry or send it to the server', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.storage.set = async () => {
    throw new Error('disk');
  };
  await assert.rejects(store.logMetric('weightKg', 81, date));
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(f.mutations.length, 0);
});
test('a slow refresh cannot overwrite a measurement logged while it was in flight', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  const get = f.connection.get;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.connection.get = async (path: string) => {
    const data = await get(path);
    await pending;
    return data;
  };
  const refresh = store.refresh(true);
  await new Promise((resolve) => setImmediate(resolve));
  f.setOnline(false);
  await store.logMetric('weightKg', 82, date);
  release();
  await refresh;
  await store.sync();
  assert.equal(
    overlayBody(store.getSnapshot().body, store.getSnapshot().operations, date)!.today!
      .weightKg,
    82,
  );
});
test('device nights take precedence and manual nights retain missing fields', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  f.setOnline(false);
  await store.saveNight('2026-10-09T13:00:00Z', '2026-10-09T21:00:00Z', 'Australia/Brisbane');
  await store.sync();
  const pending = store.getSnapshot().operations;
  const manual = overlaySleep([], pending)[0];
  assert.equal(manual.date, date);
  assert.equal(manual.durationHours, 8);
  assert.equal(manual.deepSleepHours, null);
  assert.equal(manual.avgHeartRate, null);
  const device = sleepSchema.parse({ id: id(20), date, manualEntry: false, durationHours: 7 });
  assert.equal(overlaySleep([device], pending)[0].id, id(20));
});
test('denied accounts cannot write and retain their pending records for recovery', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.logMetric('steps', 1000, date);
  await store.sync();
  f.connection.get = async () => {
    throw new ApiError(403);
  };
  await store.refresh(true);
  assert.equal(store.getSnapshot().denied, true);
  assert.equal(store.getSnapshot().operations.length, 1);
  await assert.rejects(store.logMetric('steps', 2000, date));
});
test('health records cannot be hydrated through another account scope', async () => {
  const f = fixture();
  const first = f.store();
  await first.refresh();
  const foreign = new HealthStore(f.storage, { ...f.connection, userId: 'two' }, () => id(1));
  await foreign.initialize();
  assert.equal(foreign.getSnapshot().ready, false);
  assert.equal(foreign.getSnapshot().body, null);
});
test('remembered bedtime changes only its own field and survives an offline save', async () => {
  const f = fixture();
  const get = f.connection.get;
  const measured = sleepSchema.parse({
    id: id(20),
    date,
    sleepStart: '2026-10-09T14:00:00Z',
    sleepEnd: '2026-10-09T21:00:00Z',
    durationHours: 7,
    avgHeartRate: 58,
    manualEntry: false,
  });
  f.connection.get = async (path) => (path === '/api/sleep-sessions' ? [measured] : get(path));
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.rememberBedtime(date, '2026-10-09T13:00:00Z');
  await store.sync();
  const night = overlaySleep(store.getSnapshot().sleep!, store.getSnapshot().operations)[0];
  assert.equal(night.manualSleepStart, '2026-10-09T13:00:00Z');
  assert.equal(night.sleepStart, measured.sleepStart);
  assert.equal(night.durationHours, 7);
  assert.equal(night.avgHeartRate, 58);
});
test('a partial-night mark shows at once, survives offline, and leaves the measurements alone', async () => {
  const f = fixture();
  const get = f.connection.get;
  const measured = sleepSchema.parse({
    id: id(21),
    date,
    sleepStart: '2026-10-09T18:40:00Z',
    sleepEnd: '2026-10-09T21:55:00Z',
    durationHours: 3.25,
    averageHrvMs: 47,
    manualEntry: false,
  });
  const typed = sleepSchema.parse({ id: id(22), date: '2026-10-09', durationHours: 8, manualEntry: true });
  f.connection.get = async (path) =>
    path === '/api/sleep-sessions' ? [measured, typed] : get(path);
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.markNightPartial(id(21), true);
  await store.sync();
  const read = () => overlaySleep(store.getSnapshot().sleep!, store.getSnapshot().operations);
  const marked = read().find((row) => row.id === id(21))!;
  assert.notEqual(marked.partialNightAt, null);
  assert.equal(marked.durationHours, 3.25);
  assert.equal(marked.averageHrvMs, 47);
  assert.equal(read().find((row) => row.id === id(22))!.partialNightAt ?? null, null);
  assert.equal(store.getSnapshot().operations.length, 1);
  // The queued mutation is keyed by the night's own date, which the overlay matches rows by.
  assert.equal(store.getSnapshot().operations[0].date, date);
  await store.markNightPartial(id(21), false);
  assert.equal(read().find((row) => row.id === id(21))!.partialNightAt, null);
  await assert.rejects(store.markNightPartial(id(22), true));
  await assert.rejects(store.markNightPartial(id(99), true));
});
test('closing an account stops pending health uploads without discarding them', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  f.setOnline(false);
  await store.logMetric('steps', 3000, date);
  await store.sync();
  store.cancel();
  f.setOnline(true);
  await store.sync();
  assert.equal(f.mutations.length, 0);
  assert.equal(store.getSnapshot().operations.length, 1);
  await assert.rejects(store.logMetric('steps', 4000, date));
});
test('workout invalidation refreshes health despite a fresh cache and persists while offline', async () => {
  const f = fixture();
  const first = f.store();
  await first.refresh();
  f.setOnline(false);
  await first.invalidateRecords();
  assert.equal(first.getSnapshot().stale, true);
  first.cancel();
  const second = f.store();
  await second.initialize();
  assert.equal(second.getSnapshot().stale, true);
  f.setOnline(true);
  await second.refresh();
  assert.equal(second.getSnapshot().stale, false);
  assert.equal(second.getSnapshot().bodyError, null);
});
test('manual sleep clock entry uses the account timezone across midnight and DST', () => {
  assert.deepEqual(manualNightWindow(date, '23:00', '07:00', 'Australia/Brisbane'), {
    sleepStart: '2026-10-09T13:00:00.000Z',
    sleepEnd: '2026-10-09T21:00:00.000Z',
  });
  const dst = manualNightWindow('2026-10-04', '23:00', '07:00', 'Australia/Sydney')!;
  assert.equal((Date.parse(dst.sleepEnd) - Date.parse(dst.sleepStart)) / 3_600_000, 7);
  assert.equal(manualNightWindow(date, '99:00', '07:00', 'Australia/Brisbane'), null);
});

test('"That\'s wrong" is kept while offline and posted once when the phone reconnects', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.respondToVerdict(date, 'corrected');
  assert.deepEqual(store.getSnapshot().verdictResponses, [{ date, state: 'corrected' }]);
  assert.equal(f.verdicts.length, 0);
  const reopened = f.store();
  await reopened.refresh();
  assert.equal(reopened.getSnapshot().verdictResponses.length, 1);
  f.setOnline(true);
  await reopened.sync();
  assert.deepEqual(f.verdicts, [{ date, state: 'corrected' }]);
  assert.equal(reopened.getSnapshot().verdictResponses.length, 0);
});

test('a second tap on the same night replaces the first rather than queueing twice', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.respondToVerdict(date, 'acknowledged');
  await store.respondToVerdict(date, 'corrected');
  assert.deepEqual(store.getSnapshot().verdictResponses, [{ date, state: 'corrected' }]);
});

test('a denied account cannot respond to a sleep verdict', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.connection.get = async () => {
    throw new ApiError(403);
  };
  await store.refresh(true);
  await assert.rejects(store.respondToVerdict(date, 'corrected'));
});

test('the readiness answer is kept while offline and posted once, the last tap winning', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.respondToReadiness(date, 'dismissed');
  await store.respondToReadiness(date, 'rated');
  assert.deepEqual(store.getSnapshot().readinessResponses, [{ date, state: 'rated' }]);
  const reopened = f.store();
  await reopened.refresh();
  assert.equal(reopened.getSnapshot().readinessResponses.length, 1);
  f.setOnline(true);
  await reopened.sync();
  assert.deepEqual(f.readinessAnswers, [{ date, state: 'rated' }]);
  assert.equal(reopened.getSnapshot().readinessResponses.length, 0);
});

test('a readiness answer the server rejects with a 400 is set aside, a 500 holds it', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.respondToVerdict(date, 'corrected');
  await store.respondToReadiness(date, 'rated');
  f.setOnline(true);
  const post = f.connection.post;
  (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
    if (path === '/api/sleep-verdict') {
      throw new ApiError(500);
    }
    return post(path, body);
  };
  await store.sync();
  assert.equal(store.getSnapshot().verdictResponses.length, 1);
  assert.equal(store.getSnapshot().readinessResponses.length, 1);
  (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
    if (path === '/api/sleep-verdict') {
      throw new ApiError(400, undefined, undefined, undefined, true);
    }
    return post(path, body);
  };
  await store.sync();
  assert.equal(store.getSnapshot().verdictResponses.length, 0);
  assert.equal(store.getSnapshot().readinessResponses.length, 0);
  assert.deepEqual(f.readinessAnswers, [{ date, state: 'rated' }]);
  assert.match(store.getSnapshot().setAside ?? '', /kept on this phone only/);
});

test('a readiness answer rejected with a 400 is set aside even when the sleep answer ahead of it posts fine (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.respondToVerdict(date, 'corrected');
  await store.respondToReadiness(date, 'rated');
  await store.sync(); // let the offline attempt the answer started settle
  f.setOnline(true);
  const post = f.connection.post;
  (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
    if (path === '/api/readiness-verdict') {
      throw new ApiError(400, undefined, undefined, undefined, true);
    }
    return post(path, body);
  };
  await store.sync();
  assert.equal(store.getSnapshot().verdictResponses.length, 0);
  assert.equal(store.getSnapshot().readinessResponses.length, 0);
  assert.match(store.getSnapshot().setAside ?? '', /kept on this phone only/);
});

const rejection = (m: { id: string }, retryable: boolean) => ({
  processed: 0,
  errors: [
    { id: m.id, domain: 'body_metrics', date, error: 'Rejected by the sync schema at payload: invalid', retryable },
  ],
});

test('a Health push answered 200 with a rejected item sets it aside and the accepted ones go through (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.logMetric('weightKg', 81, date);
  await store.addWater(250, date);
  await store.sync(); // let the offline attempts settle
  f.setOnline(true);
  const post = f.connection.post;
  let pushes = 0;
  (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
    if (path === '/api/sync/push' && pushes++ < 5) {
      return rejection((body as { mutations: { id: string }[] }).mutations[0], false);
    }
    return post(path, body);
  };
  // Each refusal counts; the queue waits behind it until the fifth, then the rest go through.
  for (let attempt = 1; attempt < 5; attempt++) {
    await store.sync();
    assert.equal(store.getSnapshot().operations.length, 2);
    assert.equal(store.getSnapshot().setAside, null);
  }
  await store.sync();
  const state = store.getSnapshot();
  assert.equal(state.operations.length, 0);
  assert.equal(pushes, 6);
  assert.match(state.setAside ?? '', /kept on this phone only/);
});

test('a set-aside weight stays what the person logged until the next refresh replaces it (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.logMetric('weightKg', 81, date);
  await store.sync();
  f.setOnline(true);
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) =>
    rejection((body as { mutations: { id: string }[] }).mutations[0], false);
  const shown = () => {
    const state = store.getSnapshot();
    return overlayBody(state.body, state.operations, date)?.latestWeightKg;
  };
  assert.equal(shown(), 81);
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.sync();
  }
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(shown(), 81);
  // It survives a restart, and the next refresh puts the server's value back.
  const reopened = f.store();
  await reopened.initialize();
  assert.equal(overlayBody(reopened.getSnapshot().body, [], date)?.latestWeightKg, 81);
  await store.refresh(true);
  assert.equal(shown(), 80);
});

test('a rejected change followed by a transient failure keeps the notice through a reopen (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.logMetric('weightKg', 81, date);
  await store.addWater(250, date);
  await store.sync();
  f.setOnline(true);
  let pushes = 0;
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) => {
    const m = (body as { mutations: { id: string }[] }).mutations[0];
    if (pushes++ < 5) {
      return rejection(m, false);
    }
    throw new Error('server unavailable');
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.sync();
  }
  await store.sync(); // the weight is set aside, then the water push fails
  assert.equal(store.getSnapshot().operations.length, 1);
  assert.match(store.getSnapshot().setAside ?? '', /kept on this phone only/);
  const reopened = f.store();
  await reopened.initialize();
  assert.match(reopened.getSnapshot().setAside ?? '', /kept on this phone only/);
});

test('a rejected change with a refusal that is not final is counted and kept (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.addWater(250, date);
  await store.sync();
  f.setOnline(true);
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) =>
    rejection((body as { mutations: { id: string }[] }).mutations[0], false);
  await store.sync();
  await store.sync();
  assert.equal(store.getSnapshot().operations[0].attempts, 2);
  const reopened = f.store();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().operations[0].attempts, 2);
});

test('a Health push answered 200 with a retryable error holds the queue (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.addWater(250, date);
  await store.sync();
  f.setOnline(true);
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) =>
    rejection((body as { mutations: { id: string }[] }).mutations[0], true);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 1);
  assert.match(store.getSnapshot().error ?? '', /Saved on this phone/);
  assert.equal(store.getSnapshot().setAside, null);
});

test('the Health set-aside notice survives a sync and a restart, and clears once shown (#3392)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.addWater(250, date);
  await store.sync();
  f.setOnline(true);
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) =>
    rejection((body as { mutations: { id: string }[] }).mutations[0], false);
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.sync();
  }
  const notice = store.getSnapshot().setAside;
  assert.equal(store.getSnapshot().error, null); // a saved notice is not a live failure
  assert.match(notice ?? '', /kept on this phone only/);
  await store.sync();
  assert.equal(store.getSnapshot().setAside, notice);
  assert.equal(store.getSnapshot().error, null);
  const reopened = f.store();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().setAside, notice);
  assert.equal(reopened.getSnapshot().error, null);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().setAside, notice);
  assert.equal(reopened.getSnapshot().error, null);
  await reopened.acknowledgeSetAside();
  assert.equal(reopened.getSnapshot().setAside, null);
  const again = f.store();
  await again.initialize();
  assert.equal(again.getSnapshot().setAside, null);
  assert.equal(again.getSnapshot().error, null);
});

for (const status of [401, 403]) {
  test(`a ${status} keeps every queued Health write, sleep answer and readiness answer queued (#3392)`, async () => {
    const f = fixture();
    const store = f.store();
    await store.refresh();
    f.setOnline(false);
    await store.addWater(250, date);
    await store.respondToVerdict(date, 'corrected');
    await store.respondToReadiness(date, 'rated');
    await store.sync();
    f.setOnline(true);
    (f.connection as { post: unknown }).post = async () => {
      throw new ApiError(status);
    };
    await store.sync();
    let state = store.getSnapshot();
    assert.equal(state.operations.length, 1);
    assert.match(state.error ?? '', /Saved on this phone/);
    // The two answers sit behind the stuck write; take it out of the way to reach their loops.
    (f.connection as { post: unknown }).post = async (path: string) => {
      if (path === '/api/sync/push') {
        return { processed: 1, errors: [] };
      }
      throw new ApiError(status);
    };
    await store.sync();
    state = store.getSnapshot();
    assert.equal(state.verdictResponses.length, 1);
    assert.equal(state.readinessResponses.length, 1);
    assert.doesNotMatch(state.setAside ?? '', /kept on this phone only/);
  });
}

for (const route of ['/api/sleep-verdict', '/api/readiness-verdict']) {
  test(`a ${route} answer the server's own 404 says has nothing to answer is dropped without a notice (#3392)`, async () => {
    const f = fixture();
    const store = f.store();
    await store.refresh();
    f.setOnline(false);
    await store.respondToVerdict(date, 'corrected');
    await store.respondToReadiness(date, 'rated');
    await store.sync();
    f.setOnline(true);
    const post = f.connection.post;
    (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
      if (path === route) {
        throw new ApiError(404, undefined, undefined, undefined, true);
      }
      return post(path, body);
    };
    await store.sync();
    assert.equal(store.getSnapshot().verdictResponses.length, 0);
    assert.equal(store.getSnapshot().readinessResponses.length, 0);
    assert.equal(store.getSnapshot().setAside, null);
    assert.doesNotMatch(store.getSnapshot().setAside ?? '', /kept on this phone only/);
  });

  test(`a ${route} 404 that is not the server's JSON (a proxy page, or no route) holds the answer (#3392)`, async () => {
    const f = fixture();
    const store = f.store();
    await store.refresh();
    f.setOnline(false);
    await store.respondToVerdict(date, 'corrected');
    await store.respondToReadiness(date, 'rated');
    await store.sync();
    f.setOnline(true);
    const post = f.connection.post;
    (f.connection as { post: unknown }).post = async (path: string, body: unknown) => {
      if (path === route) {
        throw new ApiError(404);
      }
      return post(path, body);
    };
    await store.sync();
    const held =
      route === '/api/sleep-verdict'
        ? store.getSnapshot().verdictResponses
        : store.getSnapshot().readinessResponses;
    assert.equal(held.length, 1);
    assert.equal(store.getSnapshot().setAside, null);
  });
}

test('a saved Health set-aside notice opens as a ready store with no live error, and a live failure beside it keeps both (#3477)', async () => {
  const f = fixture();
  const store = f.store();
  await store.refresh();
  f.setOnline(false);
  await store.addWater(250, date);
  await store.sync();
  f.setOnline(true);
  const post = (f.connection as { post: (path: string, body: unknown) => Promise<unknown> }).post;
  (f.connection as { post: unknown }).post = async (_path: string, body: unknown) =>
    rejection((body as { mutations: { id: string }[] }).mutations[0], false);
  for (let attempt = 0; attempt < 5; attempt++) {
    await store.sync();
  }
  const notice = store.getSnapshot().setAside;
  assert.match(notice ?? '', /kept on this phone only/);

  const reopened = f.store();
  await reopened.initialize();
  const opened = reopened.getSnapshot();
  assert.equal(opened.ready, true);
  assert.equal(opened.setAside, notice);
  assert.equal(opened.error, null);

  // A later live failure sits in `error`; the notice is untouched, and acknowledging it leaves the failure.
  f.setOnline(false);
  await reopened.addWater(250, date);
  (f.connection as { post: unknown }).post = post;
  await reopened.sync();
  const live = reopened.getSnapshot();
  assert.equal(live.setAside, notice);
  await reopened.acknowledgeSetAside();
  assert.equal(reopened.getSnapshot().setAside, null);
  assert.equal(reopened.getSnapshot().error, live.error);
});
