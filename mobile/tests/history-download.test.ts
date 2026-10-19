import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage, type LocalStorage } from '../src/core/storage/LocalStorage.ts';
import { HistoryDownload, type HistoryDomain } from '../src/core/sync/HistoryDownload.ts';
import { historyDomains } from '../src/features/settings/data/history-domains.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { HistoryOutbox, overlayHistory } from '../src/features/workouts/data/HistoryOutbox.ts';
import { daySpec } from '../src/features/workouts/data/models.ts';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import { foodSchema, mealTypeSchema, scaledLog } from '../src/features/nutrition/data/models.ts';
import { sqliteFixture } from './storage-fixture.ts';

const origin = 'https://example.com';
const anchor = '2026-10-19';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function openStorage(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  return { storage: await createLocalStorage(db.database), db };
}
function savedKeys(db: ReturnType<typeof sqliteFixture>, prefix: string) {
  return (
    db.connection.prepare('SELECT key FROM local_values WHERE key LIKE ?').all(`${prefix}%`) as {
      key: string;
    }[]
  ).map((row) => row.key);
}
function exercise(date: string) {
  return {
    name: 'Bench press',
    sessionName: 'Upper body',
    exerciseType: 'weighted',
    weightKg: 60,
    setWeights: [60, 60],
    sets: 2,
    reps: [8, 8],
    timeToCompleteSet: null,
    loggedAt: `${date}T09:00:00.000Z`,
    exerciseLogId: id(Number(date.slice(8))),
    workoutSessionId: id(100 + Number(date.slice(8))),
  };
}
// A server holding one workout per day. `offline` makes every read fail, as with no connection.
function server(userId: string) {
  const state = { offline: false, reads: [] as string[], pushes: 0 };
  const connection = {
    origin,
    userId,
    timezone: 'Australia/Brisbane',
    get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
      if (state.offline) {
        throw new Error('offline');
      }
      state.reads.push(`${path}?${new URLSearchParams(query).toString()}`);
      if (path === '/api/day-log') {
        return { date: query!.date, exercises: [exercise(query!.date)], userId };
      }
      if (path === '/api/calendar-data') {
        return { trainedDays: {}, activityDays: {} };
      }
      throw new Error(`Unexpected ${path}`);
    },
    post: async () => {
      state.pushes++;
      throw new Error('offline');
    },
  };
  return { state, connection };
}
function dayDomain(resources: WorkoutResources, days: number): HistoryDomain[] {
  return historyDomains({ anchor, days }, { resources, nutrition: null }).filter(
    (domain) => domain.id === 'days',
  );
}

test('a download killed mid-way resumes from its cursor without saving any day twice', async (t) => {
  const { storage, db } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  const resources = new WorkoutResources(scope, remote.connection);
  let release = () => {};
  const killed = new HistoryDownload(scope, remote.connection, () =>
    dayDomain(resources, 5).map((domain) => ({
      ...domain,
      // The third day never answers: the app is killed while it is in flight.
      fetch: (date) =>
        date === '2026-10-17'
          ? new Promise<void>((resolve) => (release = resolve))
          : domain.fetch(date),
    })),
  );
  void killed.start({ anchor, days: 5 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(killed.getSnapshot().done, 2);
  killed.stop();
  release();

  const reopened = new HistoryDownload(scope, remote.connection, () =>
    dayDomain(new WorkoutResources(scope, remote.connection), 5),
  );
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().status, 'running');
  assert.equal(reopened.getSnapshot().done, 2);
  remote.state.reads.length = 0;
  await reopened.resumeIfInterrupted();
  assert.deepEqual(remote.state.reads, [
    '/api/day-log?date=2026-10-17',
    '/api/day-log?date=2026-10-16',
    '/api/day-log?date=2026-10-15',
  ]);
  assert.equal(reopened.getSnapshot().status, 'complete');
  assert.equal(reopened.getSnapshot().done, 5);
  assert.equal(savedKeys(db, 'workout-resource.v1:["/api/day-log"').length, 5);
});

test('losing the connection mid-download keeps the cursor and carries on once back online', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  const resources = new WorkoutResources(scope, remote.connection);
  let calls = 0;
  const download = new HistoryDownload(scope, remote.connection, () =>
    dayDomain(resources, 4).map((domain) => ({
      ...domain,
      fetch: async (date) => {
        if (++calls === 3) {
          remote.state.offline = true;
        }
        await domain.fetch(date);
      },
    })),
  );
  await download.start({ anchor, days: 4 });
  assert.equal(download.getSnapshot().status, 'failed');
  assert.equal(download.getSnapshot().done, 2);
  assert.match(download.getSnapshot().error ?? '', /connection/);
  remote.state.offline = false;
  remote.state.reads.length = 0;
  await download.resumeIfInterrupted();
  assert.deepEqual(remote.state.reads, [
    '/api/day-log?date=2026-10-17',
    '/api/day-log?date=2026-10-16',
  ]);
  assert.equal(download.getSnapshot().status, 'complete');
});

test('a cancelled download stays paused across a reopen until the user resumes it', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  const resources = new WorkoutResources(scope, remote.connection);
  let gate = () => {};
  const download = new HistoryDownload(scope, remote.connection, () =>
    dayDomain(resources, 3).map((domain) => ({
      ...domain,
      fetch: async (date) => {
        await domain.fetch(date);
        if (date === anchor) {
          await new Promise<void>((resolve) => (gate = resolve));
        }
      },
    })),
  );
  const run = download.start({ anchor, days: 3 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await download.cancel();
  gate();
  await run;
  // The day that was in flight when Cancel was pressed is not counted, so it is read again.
  assert.equal(download.getSnapshot().status, 'paused');
  assert.equal(download.getSnapshot().done, 0);

  const reopened = new HistoryDownload(scope, remote.connection, () => dayDomain(resources, 3));
  remote.state.reads.length = 0;
  await reopened.resumeIfInterrupted();
  assert.equal(reopened.getSnapshot().status, 'paused');
  assert.deepEqual(remote.state.reads, []);
  await reopened.resume();
  assert.equal(reopened.getSnapshot().status, 'complete');
  assert.equal(remote.state.reads.length, 3);
});

test('downloaded days open offline after a restart, with pending history edits on top', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  await new HistoryDownload(scope, remote.connection, () =>
    dayDomain(new WorkoutResources(scope, remote.connection), 3),
  ).start({ anchor, days: 3 });

  remote.state.offline = true;
  const outbox = new HistoryOutbox(
    scope,
    remote.connection,
    () => id(900),
    () => {},
  );
  await outbox.initialize();
  await outbox.enqueue('exercise_log_delete', '2026-10-18', {
    exerciseLogId: exercise('2026-10-18').exerciseLogId,
  });
  await outbox.sync();
  assert.equal(outbox.getSnapshot().operations.length, 1);

  const reopened = new WorkoutResources(scope, remote.connection);
  for (const date of ['2026-10-19', '2026-10-18', '2026-10-17']) {
    await reopened.load(daySpec(date));
    const state = reopened.state(daySpec(date));
    assert.equal(state.data?.exercises.length, 1, date);
    assert.equal(state.saved, true);
  }
  const edited = overlayHistory(
    reopened.state(daySpec('2026-10-18')).data!.exercises,
    outbox.getSnapshot().operations,
  );
  assert.deepEqual(edited, []);

  // Downloading again while the delete is still waiting cannot bring the exercise back.
  remote.state.offline = false;
  await reopened.download(daySpec('2026-10-18'));
  const again = new WorkoutResources(scope, remote.connection);
  remote.state.offline = true;
  await again.load(daySpec('2026-10-18'));
  assert.deepEqual(
    overlayHistory(
      again.state(daySpec('2026-10-18')).data!.exercises,
      outbox.getSnapshot().operations,
    ),
    [],
  );
});

test('a download does not replace a day that changed on this phone while it was reading', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  const resources = new WorkoutResources(scope, remote.connection);
  await resources.load(daySpec(anchor));
  const get = remote.connection.get;
  remote.connection.get = async (path, query) => {
    const reply = await get(path, query);
    resources.invalidate(['/api/day-log']);
    return { ...(reply as object), exercises: [] };
  };
  await resources.download(daySpec(anchor));
  assert.equal(resources.state(daySpec(anchor)).data?.exercises.length, 1);
});

test('food logs and check-ins download into the nutrition record and pending logs stay on top', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const mealType = mealTypeSchema.parse({
    id: id(500),
    name: 'Lunch',
    emoji: '🥗',
    sortOrder: 0,
    timeStartHour: 11,
    timeEndHour: 15,
    required: true,
    remindersEnabled: false,
  });
  const food = foodSchema.parse({
    id: id(501),
    name: 'Rice',
    source: 'manual',
    servingSizeG: 100,
    calories: 130,
    proteinG: 2,
    carbsG: 29,
    fatG: 1,
  });
  let offline = false;
  const reads: string[] = [];
  const connection = {
    origin,
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
      if (offline) {
        throw new Error('offline');
      }
      reads.push(`${path}:${query?.date ?? ''}`);
      if (path.endsWith('meal-types')) {
        return [mealType];
      }
      if (path.endsWith('food-logs')) {
        return query?.date === '2026-10-18'
          ? [
              scaledLog(food, {
                id: id(600),
                date: '2026-10-18',
                mealTypeId: mealType.id,
                foodItemId: food.id,
                quantityMultiplier: 1,
                loggedAt: '2026-10-18T02:00:00.000Z',
              } as Parameters<typeof scaledLog>[1]),
            ]
          : [];
      }
      if (path.endsWith('day-checkin')) {
        return null;
      }
      throw new Error(`Unexpected ${path}`);
    },
    post: async () => {
      throw new Error('offline');
    },
  };
  const make = () =>
    new NutritionStore(
      scope,
      connection,
      (() => {
        let n = 700;
        return () => id(n++);
      })(),
      () => {},
      () => Date.parse('2026-10-19T03:00:00Z'),
    );
  const nutrition = make();
  await nutrition.initialize();
  await nutrition.refresh('mealTypes', anchor, true);
  // A food logged on this phone before the download, not yet uploaded.
  await nutrition.logFoods([{ ...food, quantityMultiplier: 2 }], anchor, mealType.id);
  assert.equal(nutrition.getSnapshot().operations.length > 0, true);

  const resources = new WorkoutResources(scope, { ...server('one').connection });
  const download = new HistoryDownload(scope, connection, (plan) =>
    historyDomains(plan, { resources, nutrition }).filter(
      (domain) => domain.id === 'food' || domain.id === 'checkins',
    ),
  );
  await download.start({ anchor, days: 2 });
  assert.equal(download.getSnapshot().status, 'complete');
  assert.deepEqual(reads.slice(1), [
    '/api/nutrition/food-logs:2026-10-19',
    '/api/nutrition/food-logs:2026-10-18',
    '/api/day-checkin:2026-10-19',
    '/api/day-checkin:2026-10-18',
  ]);

  offline = true;
  const reopened = make();
  await reopened.initialize();
  assert.equal(reopened.view('2026-10-18').logs.length, 1);
  assert.equal(reopened.view(anchor).logs.length, 1, 'the pending log survives the download');
  assert.equal(reopened.getSnapshot().operations.length > 0, true);
});

test('each account keeps its own download, and a switch mid-download writes nothing across', async (t) => {
  const { storage, db } = await openStorage(t);
  const first = server('one');
  const second = server('two');
  const scopeOne = storage.account(origin, 'one');
  const scopeTwo = storage.account(origin, 'two');
  let release = () => {};
  const one = new HistoryDownload(scopeOne, first.connection, () =>
    dayDomain(new WorkoutResources(scopeOne, first.connection), 3).map((domain) => ({
      ...domain,
      fetch: async (date) => {
        if (date === '2026-10-18') {
          await new Promise<void>((resolve) => (release = resolve));
        }
        await domain.fetch(date);
      },
    })),
  );
  void one.start({ anchor, days: 3 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The user switches to the second account: the first account's provider stops its download.
  one.stop();
  const two = new HistoryDownload(scopeTwo, second.connection, () =>
    dayDomain(new WorkoutResources(scopeTwo, second.connection), 3),
  );
  await two.initialize();
  assert.equal(two.getSnapshot().status, 'idle');
  assert.equal(two.getSnapshot().plan, null);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));

  await two.start({ anchor, days: 3 });
  const reopenedOne = new HistoryDownload(scopeOne, first.connection, () =>
    dayDomain(new WorkoutResources(scopeOne, first.connection), 3),
  );
  await reopenedOne.initialize();
  assert.equal(reopenedOne.getSnapshot().done, 1);
  assert.equal(two.getSnapshot().done, 3);

  // Each account's days are saved only in its own scope, and hold only its own records.
  const rows = db.connection
    .prepare("SELECT scope, value FROM local_values WHERE key LIKE 'workout-resource.v1:%'")
    .all() as { scope: string; value: string }[];
  for (const row of rows) {
    const owner = JSON.parse(row.scope)[2];
    assert.equal(JSON.parse(row.value).userId, owner);
    assert.equal(JSON.parse(row.value).data.userId, owner);
  }
  assert.equal(rows.filter((row) => JSON.parse(row.scope)[2] === 'two').length, 3);
});

test('a saved download from another account is never resumed', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'two');
  const remote = server('two');
  await scope.set(
    'history-download.v1',
    JSON.stringify({
      version: 1,
      origin,
      userId: 'one',
      status: 'running',
      plan: { anchor, days: 3 },
      cursors: {},
    }),
  );
  const download = new HistoryDownload(scope, remote.connection, () =>
    dayDomain(new WorkoutResources(scope, remote.connection), 3),
  );
  await download.resumeIfInterrupted();
  assert.equal(download.getSnapshot().ready, false);
  assert.deepEqual(remote.state.reads, []);
});

test('clearing an account removes its download state', async (t) => {
  const { storage } = await openStorage(t);
  const scope = storage.account(origin, 'one');
  const remote = server('one');
  await new HistoryDownload(scope, remote.connection, () =>
    dayDomain(new WorkoutResources(scope, remote.connection), 2),
  ).start({ anchor, days: 2 });
  await (storage as LocalStorage).clearAccount(origin, 'one');
  const reopened = new HistoryDownload(scope, remote.connection, () => []);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().status, 'idle');
});

test('the supported domains cover the chosen range, with food and check-ins capped at 90 days', () => {
  const domains = historyDomains(
    { anchor, days: 365 },
    { resources: { download: async () => {} }, nutrition: { refresh: async () => true } },
  );
  const sizes = Object.fromEntries(domains.map((domain) => [domain.id, domain.keys.length]));
  assert.deepEqual(sizes, { days: 365, calendar: 13, food: 90, checkins: 90, summaries: 6 });
  assert.equal(domains[0].keys[0], anchor);
  assert.equal(domains[0].keys.at(-1), '2025-10-20');
});
