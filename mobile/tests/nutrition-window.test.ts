import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { createLocalStorage, type ScopedStorage } from '../src/core/storage/LocalStorage.ts';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import {
  NUTRITION_DAYS_KEPT,
  NutritionPersistence,
  type NutritionFrame,
} from '../src/features/nutrition/data/nutrition-persistence.ts';
import { foodSchema, mealTypeSchema, scaledLog } from '../src/features/nutrition/data/models.ts';
import { sqliteFixture } from './storage-fixture.ts';

const origin = 'https://example.com';
const anchor = '2026-10-19';
const oldest = shiftDateStr(anchor, -(NUTRITION_DAYS_KEPT - 1));
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mealType = mealTypeSchema.parse({
  id: id(1),
  name: 'Lunch',
  emoji: '🥗',
  sortOrder: 0,
  timeStartHour: 0,
  timeEndHour: 23,
  required: true,
  remindersEnabled: false,
});
const food = (n: number) =>
  foodSchema.parse({
    id: id(1000 + n),
    name: `Food ${n}`,
    source: 'manual',
    servingSizeG: 100,
    calories: 200,
    proteinG: 10,
    carbsG: 20,
    fatG: 5,
    imageDataUri: `data:image/webp;base64,${String(n).padStart(4, '0')}AAAA`,
  });
const daysAgo = (n: number) => shiftDateStr(anchor, -n);
function logsFor(date: string) {
  const day = Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
  return [0, 1].map((i) =>
    scaledLog(food(day % 50), {
      id: `${id(0).slice(0, 24)}${String(day * 10 + i).padStart(12, '0')}`,
      date,
      mealTypeId: mealType.id,
      foodItemId: food(day % 50).id,
      quantityMultiplier: 1,
      loggedAt: `${date}T02:00:00.000Z`,
    } as Parameters<typeof scaledLog>[1]),
  );
}
function remote() {
  const state = { offline: false, reads: [] as string[] };
  return {
    state,
    connection: {
      origin,
      userId: 'one',
      timezone: 'Australia/Brisbane',
      get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
        if (state.offline) {
          throw new TypeError('Network request failed');
        }
        state.reads.push(`${path}:${query?.date ?? ''}`);
        if (path.endsWith('meal-types')) return [mealType];
        if (path.endsWith('food-logs')) return logsFor(query!.date);
        if (path.endsWith('day-checkin')) return { note: `Evening ${query!.date}` };
        throw new Error(`Unexpected ${path}`);
      },
      post: async () => {
        throw new TypeError('Network request failed');
      },
    },
  };
}
const make = (storage: ScopedStorage, connection: ReturnType<typeof remote>['connection']) => {
  let n = 9000;
  return new NutritionStore(
    storage,
    connection,
    () => id(n++),
    () => {},
    () => Date.parse(`${anchor}T03:00:00Z`),
  );
};
async function open(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const keys = (prefix: string) =>
    (
      db.connection.prepare('SELECT key FROM local_values WHERE key LIKE ?').all(`${prefix}%`) as {
        key: string;
      }[]
    ).map((row) => row.key);
  return { db, storage, scope: storage.account(origin, 'one'), keys };
}
// A store saved by a version that kept every day: 200 days of logs and check-ins, and optionally a
// food logged 150 days ago that has not uploaded.
async function saved200(scope: ScopedStorage, pendingDay?: string) {
  const dates = Array.from({ length: 200 }, (_, n) => daysAgo(n));
  const frame = {
    version: 1,
    origin,
    userId: 'one',
    data: {
      supplementDate: null,
      mealTypes: [mealType],
      foods: [],
      meals: [],
      supplements: [],
      targets: {},
      planLinks: {},
      days: Object.fromEntries(dates.map((date) => [date, logsFor(date)])),
      checkins: Object.fromEntries(dates.map((date) => [date, { note: `Evening ${date}` }])),
      answers: {},
      mealStatuses: {},
    },
    operations: pendingDay
      ? [
          {
            id: id(8001),
            domain: 'food_logs',
            date: pendingDay,
            payload: {
              id: id(8002),
              foodItemId: food(3).id,
              mealTypeId: mealType.id,
              quantityMultiplier: 1,
              loggedAt: `${pendingDay}T05:00:00.000Z`,
            },
            acknowledged: false,
          },
        ]
      : [],
    loaded: ['mealTypes', ...dates.map((date) => `logs:${date}`)],
    savedAt: Object.fromEntries(dates.map((date) => [`logs:${date}`, 1])),
    http: [],
  };
  // No window: written as a version that never pruned would have left it.
  await new NutritionPersistence(scope).write(frame as unknown as NutritionFrame);
}
// Counts the day entries read while the store opens.
function counting(scope: ScopedStorage) {
  const reads: string[] = [];
  return {
    reads,
    storage: {
      ...scope,
      get: async (key: string) => {
        if (key.startsWith('nutrition-day.v2:')) reads.push(key);
        return scope.get(key);
      },
    } satisfies ScopedStorage,
  };
}

test('a store with 200 saved days opens reading only the 90-day window, and drops the rest', async (t) => {
  const { scope, keys } = await open(t);
  await saved200(scope);
  assert.equal(keys('nutrition-day.v2:').length, 200);
  const server = remote();
  server.state.offline = true;
  const counted = counting(scope);
  const store = make(counted.storage, server.connection);
  await store.initialize();
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(counted.reads.length, NUTRITION_DAYS_KEPT);
  assert.ok(counted.reads.every((key) => key.slice(-10) >= oldest));
  assert.equal(Object.keys(store.getSnapshot().data.days).length, NUTRITION_DAYS_KEPT);
  assert.equal(store.view(oldest).logs.length, 2);
  // The older days are gone from the phone, so the next open reads the window too.
  assert.equal(keys('nutrition-day.v2:').length, NUTRITION_DAYS_KEPT);
  const again = counting(scope);
  await make(again.storage, server.connection).initialize();
  assert.equal(again.reads.length, NUTRITION_DAYS_KEPT);
});

test('an old day with a change waiting to upload is never dropped', async (t) => {
  const { scope, keys } = await open(t);
  const pendingDay = daysAgo(150);
  await saved200(scope, pendingDay);
  const server = remote();
  server.state.offline = true;
  const store = make(scope, server.connection);
  await store.initialize();
  assert.ok(keys('nutrition-day.v2:').includes(`nutrition-day.v2:${pendingDay}`));
  assert.equal(store.view(pendingDay).logs.length, 3, 'two saved logs and the pending one');
  assert.equal(keys('nutrition-day.v2:').length, NUTRITION_DAYS_KEPT + 1);
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.view(pendingDay).logs.length, 3);
  assert.equal(reopened.getSnapshot().operations.length, 1);
});

test('a food logged offline on an old day keeps that day on the phone until it uploads', async (t) => {
  const { scope, keys } = await open(t);
  const server = remote();
  const store = make(scope, server.connection);
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  const old = daysAgo(120);
  // A screen asks for an old day: it comes from the server and is not kept.
  assert.equal(await store.refresh('logs', old, true), true);
  assert.equal(store.view(old).logs.length, 2);
  assert.ok(!keys('nutrition-day.v2:').includes(`nutrition-day.v2:${old}`));
  // A food logged on that day offline keeps it until the change uploads.
  server.state.offline = true;
  await store.logFoods([{ ...food(7), quantityMultiplier: 1 }], old, mealType.id);
  assert.ok(keys('nutrition-day.v2:').includes(`nutrition-day.v2:${old}`));
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.view(old).logs.length, 3);
});

test('a day older than the window still opens from the server when a screen asks for it', async (t) => {
  const { scope } = await open(t);
  await saved200(scope);
  const server = remote();
  const store = make(scope, server.connection);
  await store.initialize();
  const old = daysAgo(180);
  assert.equal(store.view(old).logs.length, 0);
  server.state.reads.length = 0;
  assert.equal(await store.refresh('logs', old, true), true);
  assert.deepEqual(server.state.reads, [`/api/nutrition/food-logs:${old}`]);
  assert.equal(store.view(old).logs.length, 2);
});

test('a prune killed at any point leaves a store that opens with the window intact', async (t) => {
  // How many writes the prune makes, counted once.
  const probe = await open(t);
  await saved200(probe.scope);
  const server = remote();
  server.state.offline = true;
  let steps = 0;
  const counted: ScopedStorage = {
    get: probe.scope.get,
    keys: probe.scope.keys,
    set: async (key, value) => {
      steps++;
      await probe.scope.set(key, value);
    },
    remove: async (key) => {
      steps++;
      await probe.scope.remove(key);
    },
  };
  await make(counted, server.connection).initialize();
  assert.ok(steps > 100, `the prune made ${steps} writes`);
  for (const killAt of [0, 1, 2, 3, Math.floor(steps / 2), steps - 2, steps - 1]) {
    const { scope, keys } = await open(t);
    await saved200(scope);
    let done = 0;
    const dying: ScopedStorage = {
      get: scope.get,
      keys: scope.keys,
      set: async (key, value) => {
        if (done++ >= killAt) throw new Error('killed');
        await scope.set(key, value);
      },
      remove: async (key) => {
        if (done++ >= killAt) throw new Error('killed');
        await scope.remove(key);
      },
    };
    await make(dying, server.connection).initialize();
    const reopened = make(scope, server.connection);
    await reopened.initialize();
    assert.equal(reopened.getSnapshot().ready, true, `killed after ${killAt} writes`);
    assert.equal(
      Object.keys(reopened.getSnapshot().data.days).length,
      NUTRITION_DAYS_KEPT,
      `killed after ${killAt} writes`,
    );
    assert.equal(reopened.view(oldest).logs.length, 2, `killed after ${killAt} writes`);
    // Whatever the cut-short prune left behind is gone once the store has opened again.
    assert.ok(
      keys('nutrition-day.v2:').every((key) => key.slice(-10) >= oldest),
      `killed after ${killAt} writes`,
    );
  }
});

test('pruning leaves the photos of kept days in place and removes the ones only old days showed', async (t) => {
  const { scope, keys } = await open(t);
  await saved200(scope);
  const photosBefore = keys('nutrition-photo.v1:');
  const server = remote();
  server.state.offline = true;
  const writes: string[] = [];
  const recorded: ScopedStorage = {
    ...scope,
    setMany: async (entries) => {
      writes.push(...entries.filter(([, value]) => value !== null).map(([key]) => key));
      await scope.setMany!(entries);
    },
  };
  const store = make(recorded, server.connection);
  await store.initialize();
  assert.ok(!writes.some((key) => key.startsWith('nutrition-photo.v1:')), 'no photo rewritten');
  const kept = new Set(
    Object.values(store.getSnapshot().data.days)
      .flat()
      .map((log) => `nutrition-photo.v1:food:${log.foodItemId}`),
  );
  assert.deepEqual(keys('nutrition-photo.v1:').sort(), [...kept].sort());
  assert.ok(photosBefore.length >= kept.size);
});

test('old #3096 day entries are removed even when their index is damaged', async (t) => {
  const { scope, keys } = await open(t);
  const server = remote();
  const store = make(scope, server.connection);
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  await store.download('logs', anchor);
  // Leftovers of the earlier shape, with an index that no longer parses.
  await scope.set('nutrition-records.v2', '{broken');
  await scope.set('nutrition-day.v1:2026-10-01', '[]');
  await scope.set('nutrition-day.v1:2026-10-02', '[]');
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().ready, true);
  assert.deepEqual(keys('nutrition-day.v1:'), []);
  assert.deepEqual(keys('nutrition-records.v2'), []);
  assert.equal(reopened.view(anchor).logs.length, 2);
});
