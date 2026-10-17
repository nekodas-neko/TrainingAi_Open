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
