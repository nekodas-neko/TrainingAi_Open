import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthStore, overlaySleep } from '../src/features/health/data/HealthStore.ts';
import { bodySpec } from '../src/features/health/data/models.ts';
import { morningSchema, checkinSchema } from '../src/features/health/data/checkin.ts';
import { clinicalPayload } from '../src/features/health/data/clinical.ts';
import { saveSleepValue } from '../src/features/health/data/save-sleep-value.ts';
const date = '2026-10-11';
const payload = morningSchema.parse({
  phase: 'morning',
  sleepQualityFeel: 3,
  sleepQualityFeelTouched: false,
  perceivedRecovery: null,
  perceivedRecoveryTouched: false,
  vsNormal: 'same',
  vsQuestion: 2,
  vsNormalTouched: false,
  illnessContext: null,
});
function fixture() {
  const disk = new Map<string, string>();
  let sequence = 0;
  let online = false;
  let lostReply = false;
  let failVerdict = false;
  let missingRead = false;
  let row: unknown = null;
  const applied = new Set<string>();
  const posts: { path: string; body: any }[] = [];
  const storage = {
    get: async (k: string) => disk.get(k) ?? null,
    set: async (k: string, v: string) => {
      disk.set(k, v);
    },
    remove: async (k: string) => {
      disk.delete(k);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string) => {
      if (!online) {
        throw new Error('offline');
      }
      if (path === '/api/day-checkin') {
        return missingRead ? null : row;
      }
      return path === '/api/body-metadata'
        ? bodySpec(date).schema.parse({ today: null, recent: [] })
        : [];
    },
    post: async (path: string, body: any) => {
      if (!online) {
        throw new Error('offline');
      }
      posts.push({ path, body });
      if (path === '/api/sleep-verdict') {
        if (failVerdict) {
          throw new Error('offline');
        }
        return { ok: true };
      }
      const mutation = body.mutations[0];
      if (!applied.has(mutation.id)) {
        applied.add(mutation.id);
        row = checkinSchema.parse(mutation.payload);
      }
      if (lostReply) {
        lostReply = false;
        throw new Error('lost reply');
      }
      return { processed: 1, errors: [] };
    },
  };
  return {
    disk,
    posts,
    applied,
    store: () =>
      new HealthStore(
        storage,
        connection,
        () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        () => {},
        () => Date.parse(date + 'T12:00:00Z'),
      ),
    online: () => {
      online = true;
    },
    loseReply: () => {
      lostReply = true;
    },
    failVerdict: () => {
      failVerdict = true;
    },
    recoverVerdict: () => {
      failVerdict = false;
    },
    missing: () => {
      missingRead = true;
    },
    restoreRead: () => {
      missingRead = false;
    },
  };
}
test('morning answers survive reopening offline without becoming sleep records', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  await store.saveCheckin(date, payload);
  await store.sync();
  assert.equal(store.getSnapshot().operations[0].domain, 'day_checkins');
  assert.deepEqual(overlaySleep([], store.getSnapshot().operations), []);
  store.cancel();
  const reopened = f.store();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().operations[0].payload.vsNormalTouched, false);
  f.online();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 0);
  assert.equal(reopened.getSnapshot().checkins[date]?.vsNormal, 'same');
  const again = f.store();
  await again.initialize();
  assert.equal(again.getSnapshot().checkins[date]?.sleepQualityFeelTouched, false);
});
test('a lost morning upload reply retries the same mutation identity', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  await store.saveCheckin(date, payload);
  await store.sync();
  f.online();
  f.loseReply();
  await store.sync();
  const first = f.posts[0].body.mutations[0].id;
  await store.sync();
  assert.equal(f.posts[1].body.mutations[0].id, first);
  assert.equal(f.applied.size, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
});
test('empty check-in readback and unrelated sleep reads cannot discard an acknowledged morning write', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  await store.saveCheckin(date, payload);
  await store.sync();
  f.online();
  f.missing();
  await store.sync();
  assert.equal(store.getSnapshot().operations[0].acknowledged, true);
  await store.refresh(true);
  assert.equal(store.getSnapshot().operations.length, 1);
  f.restoreRead();
  await store.sync();
  assert.equal(f.posts.length, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
});
test('explicit verdict responses persist independently after the morning answer is confirmed', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  await store.saveCheckin(
    date,
    { ...payload, sleepQualityFeel: 5, sleepQualityFeelTouched: true },
    'corrected',
  );
  await store.sync();
  f.online();
  f.failVerdict();
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.getSnapshot().verdictResponses[0].state, 'corrected');
  store.cancel();
  const reopened = f.store();
  await reopened.initialize();
  f.recoverVerdict();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().verdictResponses.length, 0);
  assert.equal(f.posts.filter((p) => p.path === '/api/sync/push').length, 1);
});
test('saving a morning sheet alone creates no verdict acknowledgement', async () => {
  const f = fixture();
  const store = f.store();
  await store.initialize();
  await store.saveCheckin(date, payload);
  await store.sync();
  assert.equal(store.getSnapshot().verdictResponses.length, 0);
});
test('sleep feedback preserves stored direction and records only corrections as touched', () => {
  assert.deepEqual(saveSleepValue(null, null), { value: 3, touched: false });
  assert.deepEqual(saveSleepValue(1, null), { value: 1, touched: true });
  assert.deepEqual(saveSleepValue(null, { verdict: 'good' } as any), {
    value: 2,
    touched: false,
  });
  assert.deepEqual(saveSleepValue(null, { verdict: 'poor' } as any), {
    value: 4,
    touched: false,
  });
});
test('clinical fields reject invalid dates and values while preserving signed bone scores and gram units', () => {
  assert.throws(() => clinicalPayload('rmr', { measuredOn: '2026-02-30', rmrKcal: '1325' }));
  assert.throws(() => clinicalPayload('rmr', { measuredOn: date, rmrKcal: 'Infinity' }));
  assert.throws(() => clinicalPayload('rmr', { measuredOn: date, rmrKcal: '1325.5' }));
  assert.throws(() => clinicalPayload('dexa', { scannedOn: date, pctFat: '101' }));
  const scan = clinicalPayload('dexa', {
    scannedOn: date,
    pctFat: '28.5',
    tScore: '-1.6',
    leanPlusBmcG: '51460.1',
    weightKg: '',
  });
  assert.equal('tScore' in scan ? scan.tScore : null, -1.6);
  assert.equal('leanPlusBmcG' in scan ? scan.leanPlusBmcG : null, 51460.1);
  assert.equal('weightKg' in scan ? scan.weightKg : undefined, undefined);
});
import { dayTimeInstant } from '../src/features/health/data/manual-night.ts';
import { HistoryOutbox } from '../src/features/workouts/data/HistoryOutbox.ts';
test('activity timestamps retain the account timezone and reject nonexistent DST wall times', () => {
  assert.equal(
    dayTimeInstant(date, '23:15:22', 'Australia/Brisbane'),
    '2026-10-11T13:15:22.000Z',
  );
  assert.equal(dayTimeInstant('2026-03-08', '02:30:00', 'America/New_York'), null);
  assert.equal(dayTimeInstant(date, '25:15:00', 'Australia/Brisbane'), null);
});
test('activity deletion remains queued through failed or mismatched readback and retries idempotently', async () => {
  const disk = new Map<string, string>();
  let validRead = false;
  const uploaded: string[] = [];
  const queue = new HistoryOutbox(
    {
      get: async (k) => disk.get(k) ?? null,
      set: async (k, v) => {
        disk.set(k, v);
      },
      remove: async (k) => {
        disk.delete(k);
      },
    },
    {
      origin: 'https://example.com',
      userId: 'one',
      timezone: 'Australia/Brisbane',
      get: async () => ({
        date,
        activityLogs: validRead ? [] : [{ id: '20000000-0000-4000-8000-000000000001' }],
      }),
      post: async (_, body) => {
        uploaded.push((body as any).mutations[0].id);
        return { processed: 1, errors: [] };
      },
    },
    () => '10000000-0000-4000-8000-000000000001',
    () => {},
  );
  await queue.initialize();
  await queue.enqueue('activity_logs', date, {
    id: '20000000-0000-4000-8000-000000000001',
    deleted: true,
  });
  await queue.sync();
  assert.equal(queue.getSnapshot().operations.length, 1);
  validRead = true;
  await queue.sync();
  assert.equal(queue.getSnapshot().operations.length, 0);
  assert.equal(new Set(uploaded).size, 1);
});
