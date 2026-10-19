import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { createLocalStorage, type ScopedStorage } from '../src/core/storage/LocalStorage.ts';
import { HistoryDownload } from '../src/core/sync/HistoryDownload.ts';
import { historyDomains } from '../src/features/settings/data/history-domains.ts';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import {
  foodSchema,
  mealSchema,
  mealTypeSchema,
  scaledLog,
  type FoodLog,
} from '../src/features/nutrition/data/models.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { sqliteFixture } from './storage-fixture.ts';

const origin = 'https://example.com';
const anchor = '2026-10-19';
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
// A 12 KB thumbnail, base64 as the server sends it.
const photoOf = (n: number) =>
  `data:image/webp;base64,${String(n).padStart(6, '0')}${'A'.repeat(16_000)}`;
// Thirty photographed foods eaten in rotation, three a day, plus seven unphotographed logs a day.
function food(n: number, photographed: boolean) {
  return foodSchema.parse({
    id: id(1000 + n),
    name: `Food ${n}`,
    source: 'manual',
    servingSizeG: 100,
    calories: 250,
    proteinG: 12,
    carbsG: 30,
    fatG: 8,
    ...(photographed ? { imageDataUri: photoOf(n) } : {}),
  });
}
// A saved meal with its own photo, made of two foods with photos.
function meal(n: number) {
  return mealSchema.parse({
    id: id(7000 + n),
    name: `Meal ${n}`,
    servings: 1,
    imageDataUri: photoOf(500 + n),
    mealTypeIds: [mealType.id],
    items: [food(n, true), food(n + 1, true)].map((item, index) => ({
      id: id(7100 + n * 10 + index),
      foodItemId: item.id,
      quantityMultiplier: 1,
      foodItem: item,
    })),
    totals: { calories: 500, proteinG: 24, carbsG: 60, fatG: 16 },
  });
}
function logsFor(date: string): FoodLog[] {
  const day = Math.round(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
  return Array.from({ length: 10 }, (_, i) => {
    const item = i < 3 ? food((day * 3 + i) % 30, true) : food(100 + i, false);
    return scaledLog(item, {
      id: `${id(0).slice(0, 24)}${String(day * 10 + i).padStart(12, '0')}`,
      date,
      mealTypeId: mealType.id,
      foodItemId: item.id,
      quantityMultiplier: 1,
      loggedAt: `${date}T02:00:00.000Z`,
    } as Parameters<typeof scaledLog>[1]);
  });
}
function remote(userId = 'one') {
  const state = { offline: false, meals: [] as ReturnType<typeof meal>[] };
  return {
    state,
    connection: {
      origin,
      userId,
      timezone: 'Australia/Brisbane',
      get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
        if (state.offline) {
          throw new TypeError('Network request failed');
        }
        if (path.endsWith('meal-types')) {
          return [mealType];
        }
        if (path.endsWith('food-logs')) {
          return logsFor(query!.date);
        }
        if (path.endsWith('saved-meals')) {
          return state.meals;
        }
        if (path.endsWith('day-checkin')) {
          return null;
        }
        throw new Error(`Unexpected ${path}`);
      },
      post: async () => {
        throw new TypeError('Network request failed');
      },
    },
  };
}
// Counts what each change sends to the phone's storage.
function spy(scope: ScopedStorage) {
  const writes: { keys: string[]; bytes: number }[] = [];
  return {
    writes,
    storage: {
      ...scope,
      set: async (key: string, value: string) => {
        writes.push({ keys: [key], bytes: value.length });
        await scope.set(key, value);
      },
      setMany: async (entries: [string, string | null][]) => {
        writes.push({
          keys: entries.map(([key]) => key),
          bytes: entries.reduce((sum, [, value]) => sum + (value?.length ?? 0), 0),
        });
        await scope.setMany!(entries);
      },
    } satisfies ScopedStorage,
  };
}
async function open(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const saved = () =>
    db.connection.prepare('SELECT key, length(value) AS size FROM local_values').all() as {
      key: string;
      size: number;
    }[];
  return { storage, scope: storage.account(origin, 'one'), saved };
}
const make = (storage: ScopedStorage, connection: ReturnType<typeof remote>['connection']) => {
  let n = 5000;
  return new NutritionStore(
    storage,
    connection,
    () => id(n++),
    () => {},
    () => Date.parse(`${anchor}T03:00:00Z`),
  );
};
async function restore90(store: NutritionStore) {
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  for (let day = 0; day < 90; day++) {
    await store.download('logs', shiftDateStr(anchor, -day));
  }
}

test('90 days with photos: each photo is saved once, and a food log writes only the core record', async (t) => {
  const { scope, saved } = await open(t);
  const server = remote();
  const recorded = spy(scope);
  const store = make(recorded.storage, server.connection);
  await restore90(store);
  const downloadBytes = recorded.writes.reduce((sum, write) => sum + write.bytes, 0);
  const total = saved().reduce((sum, row) => sum + row.size, 0);
  // The old single record held all 90 days with a copy of the photo in every photographed log.
  const legacy = JSON.stringify({ data: store.getSnapshot().data }).length;
  assert.equal(saved().filter((row) => row.key.startsWith('nutrition-photo.v1:')).length, 30);
  assert.equal(saved().filter((row) => row.key.startsWith('nutrition-day.v1:')).length, 90);
  assert.ok(total < legacy / 4, `saved ${total} bytes, the single record was ${legacy}`);
  assert.ok(downloadBytes < 2_000_000, `the download wrote ${downloadBytes} bytes`);

  recorded.writes.length = 0;
  server.state.offline = true;
  await store.logFoods([{ ...food(7, true), quantityMultiplier: 1 }], anchor, mealType.id);
  assert.deepEqual(
    recorded.writes.map((write) => write.keys),
    [['nutrition-records.v2']],
  );
  assert.ok(recorded.writes[0].bytes < 20_000, `one log wrote ${recorded.writes[0].bytes} bytes`);
  assert.ok(legacy > 1_500_000, 'the single record would have rewritten over 1.5 MB');
});

test('a day that changed on the server rewrites only that day', async (t) => {
  const { scope } = await open(t);
  const server = remote();
  const recorded = spy(scope);
  const store = make(recorded.storage, server.connection);
  await restore90(store);
  recorded.writes.length = 0;
  // The day changed on the server: another log was added to it from another device.
  const get = server.connection.get;
  server.connection.get = async (path, query) => {
    const reply = await get(path, query);
    return path.endsWith('food-logs') ? [...(reply as FoodLog[]), logsFor(anchor)[5]] : reply;
  };
  await store.refresh('logs', shiftDateStr(anchor, -10), true);
  // The core record is unchanged here: the test clock does not move, so the day's saved time is
  // the same. No other day and no photo is rewritten.
  assert.deepEqual(
    recorded.writes.map((write) => write.keys),
    [['nutrition-day.v1:2026-10-09']],
  );
});

test('reopening reads back every log with its photo, and pending logs still overlay offline', async (t) => {
  const { scope } = await open(t);
  const server = remote();
  const first = make(scope, server.connection);
  await restore90(first);
  server.state.offline = true;
  await first.logFoods([{ ...food(3, true), quantityMultiplier: 2 }], anchor, mealType.id);
  const before = first.getSnapshot();

  const reopened = make(scope, server.connection);
  await reopened.initialize();
  const after = reopened.getSnapshot();
  assert.equal(after.ready, true);
  assert.deepEqual(after.data, before.data);
  assert.deepEqual(after.operations, before.operations);
  assert.equal(reopened.view(anchor).logs.length, 11);
  assert.equal(
    reopened.view('2026-08-01').logs.filter((log) => log.foodItem.imageDataUri).length,
    3,
  );
});

test('the old single record moves across on first launch in one step, and nothing is lost', async (t) => {
  const { scope, saved } = await open(t);
  const server = remote();
  const days = Object.fromEntries(
    [0, 1, 2].map((day) => [shiftDateStr(anchor, -day), logsFor(shiftDateStr(anchor, -day))]),
  );
  const pending = {
    id: id(9001),
    domain: 'food_logs',
    date: anchor,
    payload: {
      id: id(9002),
      foodItemId: food(4, true).id,
      mealTypeId: mealType.id,
      quantityMultiplier: 1,
      loggedAt: `${anchor}T05:00:00.000Z`,
    },
  };
  const legacy = {
    version: 1,
    origin,
    userId: 'one',
    data: {
      supplementDate: null,
      mealTypes: [mealType],
      foods: [food(4, true)],
      meals: [meal(1), meal(4)],
      supplements: [],
      targets: {},
      days,
      planLinks: {},
      checkins: {},
      answers: {},
      mealStatuses: {},
    },
    operations: [pending],
    loaded: ['mealTypes'],
    savedAt: { mealTypes: 1 },
    http: [],
  };
  await scope.set('nutrition-records.v1', JSON.stringify(legacy));
  const recorded = spy(scope);
  server.state.offline = true;
  const store = make(recorded.storage, server.connection);
  await store.initialize();
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(recorded.writes.length, 1, 'one transaction');
  assert.ok(recorded.writes[0].keys.includes('nutrition-records.v1'));
  const keys = saved().map((row) => row.key);
  assert.ok(!keys.includes('nutrition-records.v1'));
  assert.ok(keys.includes('nutrition-records.v2'));
  assert.equal(keys.filter((key) => key.startsWith('nutrition-day.v1:')).length, 3);

  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.deepEqual(reopened.getSnapshot().data.days, store.getSnapshot().data.days);
  assert.deepEqual(reopened.getSnapshot().data.foods, legacy.data.foods);
  assert.deepEqual(reopened.getSnapshot().data.meals, legacy.data.meals);
  assert.equal(reopened.getSnapshot().data.meals[0].imageDataUri, photoOf(501));
  assert.equal(reopened.getSnapshot().data.meals[1].items[0].foodItem.imageDataUri, photoOf(4));
  assert.equal(reopened.getSnapshot().operations.length, 1);
  assert.equal(reopened.view(anchor).logs.length, 11, 'the pending log still overlays');
});

test('a move that fails keeps the old record, and the next change moves it', async (t) => {
  const { scope, saved } = await open(t);
  const server = remote();
  server.state.offline = true;
  await scope.set(
    'nutrition-records.v1',
    JSON.stringify({
      version: 1,
      origin,
      userId: 'one',
      data: {
        mealTypes: [mealType],
        foods: [],
        meals: [],
        supplements: [],
        targets: {},
        days: { [anchor]: logsFor(anchor) },
        checkins: {},
        answers: {},
      },
      operations: [],
      loaded: [],
      savedAt: {},
    }),
  );
  let full = true;
  const failing: ScopedStorage = {
    ...scope,
    setMany: async (entries) => {
      if (full) {
        throw new Error('disk full');
      }
      await scope.setMany!(entries);
    },
  };
  const store = make(failing, server.connection);
  await store.initialize();
  assert.equal(store.getSnapshot().ready, true);
  assert.ok(saved().some((row) => row.key === 'nutrition-records.v1'));
  full = false;
  await store.logFoods([{ ...food(1, true), quantityMultiplier: 1 }], anchor, mealType.id);
  const keys = saved().map((row) => row.key);
  assert.ok(!keys.includes('nutrition-records.v1'));
  assert.ok(keys.includes(`nutrition-day.v1:${anchor}`));
});

test('a corrupt or another account’s saved core is kept and never overwritten', async (t) => {
  const { scope } = await open(t);
  const server = remote();
  // A well-formed core record saved by another account, so only the account check can refuse it.
  const other = JSON.stringify({
    version: 2,
    origin,
    userId: 'two',
    dayKeys: [],
    data: {
      supplementDate: null,
      mealTypes: [mealType],
      foods: [],
      meals: [],
      supplements: [],
      targets: {},
      planLinks: {},
      checkins: {},
      answers: {},
      mealStatuses: {},
    },
    operations: [],
    loaded: [],
    savedAt: {},
    http: [],
  });
  for (const raw of ['{broken', other]) {
    await scope.set('nutrition-records.v2', raw);
    const store = make(scope, server.connection);
    await store.initialize();
    assert.equal(store.getSnapshot().ready, false);
    await assert.rejects(
      store.logFoods([{ ...food(1, false), quantityMultiplier: 1 }], anchor, mealType.id),
    );
    assert.equal(await scope.get('nutrition-records.v2'), raw);
  }
});

test('a history download killed mid-way still resumes from its cursor into the per-day records', async (t) => {
  const { scope, saved } = await open(t);
  const server = remote();
  const store = make(scope, server.connection);
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  const resources = new WorkoutResources(scope, server.connection);
  let release = () => {};
  const killed = new HistoryDownload(scope, server.connection, (plan) =>
    historyDomains(plan, { resources, nutrition: store })
      .filter((domain) => domain.id === 'food')
      .map((domain) => ({
        ...domain,
        fetch: (date) =>
          date === shiftDateStr(anchor, -2)
            ? new Promise<void>((resolve) => (release = resolve))
            : domain.fetch(date),
      })),
  );
  void killed.start({ anchor, days: 5 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  killed.stop();
  release();
  const reopenedStore = make(scope, server.connection);
  const reopened = new HistoryDownload(scope, server.connection, (plan) =>
    historyDomains(plan, { resources, nutrition: reopenedStore }).filter(
      (domain) => domain.id === 'food',
    ),
  );
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().done, 2);
  await reopened.resumeIfInterrupted();
  assert.equal(reopened.getSnapshot().status, 'complete');
  assert.equal(saved().filter((row) => row.key.startsWith('nutrition-day.v1:')).length, 5);
  server.state.offline = true;
  const offline = make(scope, server.connection);
  await offline.initialize();
  assert.equal(offline.view(shiftDateStr(anchor, -4)).logs.length, 10);
});

test('a batch of writes that fails part-way leaves nothing changed', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  let writes = 0;
  const storage = await createLocalStorage({
    ...db.database,
    runAsync: async (sql, ...params) => {
      if (sql.startsWith('INSERT') && ++writes === 3) {
        throw new Error('disk full');
      }
      return db.database.runAsync(sql, ...params);
    },
  });
  const scope = storage.account(origin, 'one');
  await scope.set('a', 'old');
  await assert.rejects(
    scope.setMany!([
      ['a', 'new'],
      ['b', 'new'],
      ['c', 'new'],
    ]),
  );
  assert.equal(await scope.get('a'), 'old');
  assert.equal(await scope.get('b'), null);
  await scope.setMany!([
    ['a', null],
    ['b', 'new'],
  ]);
  assert.equal(await scope.get('a'), null);
  assert.equal(await scope.get('b'), 'new');
});

test('deleting the account while the old record is being read never writes it back', async (t) => {
  const { storage, scope, saved } = await open(t);
  const server = remote();
  server.state.offline = true;
  await scope.set(
    'nutrition-records.v1',
    JSON.stringify({
      version: 1,
      origin,
      userId: 'one',
      data: {
        mealTypes: [mealType],
        foods: [food(1, true)],
        meals: [meal(2)],
        supplements: [],
        targets: {},
        days: { [anchor]: logsFor(anchor) },
        checkins: {},
        answers: {},
      },
      operations: [],
      loaded: [],
      savedAt: {},
    }),
  );
  let store: NutritionStore | null = null;
  let cleared: Promise<unknown> = Promise.resolve();
  // Delete Account runs `cancel()` then clears the account's storage, here just as the old record
  // has been read and before the store has moved it.
  const racing: ScopedStorage = {
    ...scope,
    get: async (key) => {
      const value = await scope.get(key);
      if (key === 'nutrition-records.v1') {
        store!.cancel();
        cleared = storage.clearAccount(origin, 'one');
      }
      return value;
    },
  };
  store = make(racing, server.connection);
  await store.initialize();
  await cleared;
  assert.deepEqual(saved(), []);
});

test('a photo nothing shows any more is removed from storage', async (t) => {
  const { scope, saved } = await open(t);
  const server = remote();
  server.state.meals = [meal(1)];
  const store = make(scope, server.connection);
  await store.initialize();
  await store.refresh('meals', anchor, true);
  const photos = () =>
    saved()
      .filter((row) => row.key.startsWith('nutrition-photo.v1:'))
      .map((row) => row.key)
      .sort();
  assert.deepEqual(photos(), [
    `nutrition-photo.v1:food:${id(1001)}`,
    `nutrition-photo.v1:food:${id(1002)}`,
    `nutrition-photo.v1:meal:${id(7001)}`,
  ]);
  server.state.meals = [];
  await store.refresh('meals', anchor, true);
  assert.deepEqual(photos(), []);
});

test('a saved day that has gone missing stops the records opening instead of showing it empty', async (t) => {
  const { scope } = await open(t);
  const server = remote();
  const store = make(scope, server.connection);
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  await store.download('logs', anchor);
  await store.download('logs', shiftDateStr(anchor, -1));
  const core = await scope.get('nutrition-records.v2');
  await scope.remove(`nutrition-day.v1:${anchor}`);
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().ready, false);
  await assert.rejects(
    reopened.logFoods([{ ...food(1, false), quantityMultiplier: 1 }], anchor, mealType.id),
  );
  assert.equal(await scope.get('nutrition-records.v2'), core);
});
