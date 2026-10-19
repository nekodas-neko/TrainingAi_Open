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
  assert.equal(saved().filter((row) => row.key.startsWith('nutrition-day.v2:')).length, 90);
  assert.ok(total < legacy / 4, `saved ${total} bytes, the single record was ${legacy}`);
  assert.ok(downloadBytes < 2_000_000, `the download wrote ${downloadBytes} bytes`);

  recorded.writes.length = 0;
  server.state.offline = true;
  await store.logFoods([{ ...food(7, true), quantityMultiplier: 1 }], anchor, mealType.id);
  assert.deepEqual(
    recorded.writes.map((write) => write.keys),
    [['nutrition-records.v3']],
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
    [['nutrition-day.v2:2026-10-09']],
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
  assert.ok(keys.includes('nutrition-records.v3'));
  assert.equal(keys.filter((key) => key.startsWith('nutrition-day.v2:')).length, 3);

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
  assert.ok(keys.includes(`nutrition-day.v2:${anchor}`));
});

test('a corrupt or another account’s saved core is kept and never overwritten', async (t) => {
  const { scope } = await open(t);
  const server = remote();
  // A well-formed core record saved by another account, so only the account check can refuse it.
  const other = JSON.stringify({
    version: 3,
    origin,
    userId: 'two',
    dayKeys: [],
    data: {
      supplementDate: null,
      mealTypes: [mealType],
      supplements: [],
      targets: {},
      planLinks: {},
    },
    operations: [],
    loaded: [],
    savedAt: {},
    http: [],
  });
  await scope.set('nutrition-library.v1', JSON.stringify({ foods: [], meals: [] }));
  for (const raw of ['{broken', other]) {
    await scope.set('nutrition-records.v3', raw);
    const store = make(scope, server.connection);
    await store.initialize();
    assert.equal(store.getSnapshot().ready, false);
    await assert.rejects(
      store.logFoods([{ ...food(1, false), quantityMultiplier: 1 }], anchor, mealType.id),
    );
    assert.equal(await scope.get('nutrition-records.v3'), raw);
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
  assert.equal(saved().filter((row) => row.key.startsWith('nutrition-day.v2:')).length, 5);
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
  const core = await scope.get('nutrition-records.v3');
  await scope.remove(`nutrition-day.v2:${anchor}`);
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().ready, false);
  await assert.rejects(
    reopened.logFoods([{ ...food(1, false), quantityMultiplier: 1 }], anchor, mealType.id),
  );
  assert.equal(await scope.get('nutrition-records.v3'), core);
});

// A server holding a full history: a 300-food library, and for each day an evening check-in of
// about 0.6 KB, a meal status and a plan answer.
function historyServer() {
  const server = remote();
  const library = Array.from({ length: 300 }, (_, n) => food(2000 + n, false));
  const get = server.connection.get;
  server.connection.get = async (path, query) => {
    if (server.state.offline) {
      throw new TypeError('Network request failed');
    }
    const date = query?.date ?? anchor;
    if (path.endsWith('food-items')) {
      return library;
    }
    if (path.endsWith('day-checkin')) {
      return { date, phase: 'evening', note: `Evening ${date} `.padEnd(600, '.') };
    }
    if (path.endsWith('meal-statuses')) {
      return {
        date,
        statuses: [{ mealTypeId: mealType.id, skipped: true, decisionId: id(8000) }],
      };
    }
    if (path.endsWith('plan-meal-answers')) {
      return { answers: [{ planMealId: id(8100), logDate: date, answer: 'ate' }] };
    }
    return get(path, query);
  };
  return server;
}
async function fullHistory(store: NutritionStore, days: number) {
  await store.initialize();
  await store.refresh('mealTypes', anchor, true);
  await store.refresh('foods', anchor, true);
  for (let day = 0; day < days; day++) {
    const date = shiftDateStr(anchor, -day);
    await store.download('logs', date);
    await store.download('checkin', date);
    await store.refresh('mealStatuses', date, true);
    await store.refresh('answers', date, true);
  }
}

test('with 90 days of check-ins and a 300-food library, one food log writes a small core record', async (t) => {
  const { scope, saved } = await open(t);
  const server = historyServer();
  const recorded = spy(scope);
  const store = make(recorded.storage, server.connection);
  await fullHistory(store, 90);
  const core = saved().find((row) => row.key === 'nutrition-records.v3')!.size;
  assert.ok(core < 8_000, `the core record is ${core} bytes`);
  const library = saved().find((row) => row.key === 'nutrition-library.v1')!.size;
  assert.ok(library > 40_000, 'the library is large, so it must not be in every write');

  recorded.writes.length = 0;
  server.state.offline = true;
  await store.logFoods([{ ...food(7, true), quantityMultiplier: 1 }], anchor, mealType.id);
  assert.deepEqual(
    recorded.writes.map((write) => write.keys),
    [['nutrition-records.v3']],
  );
  assert.ok(recorded.writes[0].bytes < 10_000, `one log wrote ${recorded.writes[0].bytes} bytes`);

  // A check-in changed from another device: reading that day again writes only that day.
  server.state.offline = false;
  const read = server.connection.get;
  server.connection.get = async (path, query) => {
    const reply = await read(path, query);
    return path.endsWith('day-checkin') ? { ...(reply as object), note: 'Changed' } : reply;
  };
  recorded.writes.length = 0;
  await store.refresh('checkin', shiftDateStr(anchor, -30), true);
  assert.deepEqual(
    recorded.writes.map((write) => write.keys.sort()),
    [['nutrition-day.v2:2026-09-19']],
  );
});

test('the core record grows only by its list of saved days', async (t) => {
  const sizes: number[] = [];
  for (const days of [10, 90]) {
    const { scope, saved } = await open(t);
    await fullHistory(make(scope, historyServer().connection), days);
    // Only the list of saved days grows, by one date per day; everything else stays the same.
    const { dayKeys, ...rest } = JSON.parse((await scope.get('nutrition-records.v3'))!);
    assert.equal(dayKeys.length, days);
    sizes.push(JSON.stringify(rest).length);
  }
  assert.equal(sizes[1], sizes[0], `10 days: ${sizes[0]}, 90 days: ${sizes[1]}`);
});

// The #3096 shape: a core record holding check-ins, statuses, answers, the library and every
// day's `loaded`/`savedAt` keys, food logs per day as bare lists, and photos once each.
async function savedAs3096(scope: ScopedStorage) {
  const dates = [0, 1, 2].map((day) => shiftDateStr(anchor, -day));
  const strip = (item: ReturnType<typeof food>) =>
    item.imageDataUri ? { ...item, imageDataUri: 'photo:' } : item;
  const library = { foods: [food(4, true)], meals: [meal(1)] };
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
  const core = {
    version: 2,
    origin,
    userId: 'one',
    dayKeys: dates,
    data: {
      supplementDate: null,
      mealTypes: [mealType],
      foods: library.foods.map(strip),
      meals: library.meals.map((item) => ({
        ...item,
        imageDataUri: 'photo:',
        items: item.items.map((entry) => ({ ...entry, foodItem: strip(entry.foodItem) })),
      })),
      supplements: [],
      targets: {},
      planLinks: {},
      checkins: Object.fromEntries(dates.map((date) => [date, { note: `Evening ${date}` }])),
      answers: Object.fromEntries(
        dates.map((date) => [date, [{ planMealId: id(8100), logDate: date, answer: 'ate' }]]),
      ),
      mealStatuses: { [anchor]: [] },
    },
    operations: [pending],
    loaded: ['mealTypes', ...dates.flatMap((date) => [`logs:${date}`, `checkin:${date}`])],
    savedAt: Object.fromEntries([
      ['mealTypes', 1],
      ...dates.map((date, index) => [`logs:${date}`, 100 + index]),
    ]),
    http: [],
  };
  await scope.set('nutrition-records.v2', JSON.stringify(core));
  for (const date of dates) {
    await scope.set(
      `nutrition-day.v1:${date}`,
      JSON.stringify(logsFor(date).map((log) => ({ ...log, foodItem: strip(log.foodItem) }))),
    );
  }
  const photos: Record<string, string> = {};
  for (const date of dates) {
    for (const log of logsFor(date)) {
      if (log.foodItem.imageDataUri) photos[`food:${log.foodItem.id}`] = log.foodItem.imageDataUri;
    }
  }
  photos[`food:${food(1, true).id}`] = food(1, true).imageDataUri!;
  photos[`food:${food(2, true).id}`] = food(2, true).imageDataUri!;
  photos[`food:${food(4, true).id}`] = food(4, true).imageDataUri!;
  photos[`meal:${meal(1).id}`] = meal(1).imageDataUri!;
  for (const [ref, value] of Object.entries(photos)) {
    await scope.set(`nutrition-photo.v1:${ref}`, value);
  }
  // What the store should open with, whatever shape it was saved in.
  return {
    data: {
      mealTypes: [mealType],
      ...library,
      days: Object.fromEntries(dates.map((date) => [date, logsFor(date)])),
      checkins: core.data.checkins,
      answers: core.data.answers,
      mealStatuses: core.data.mealStatuses,
    },
    loaded: [...core.loaded].sort(),
    savedAt: core.savedAt,
    operations: [{ ...pending, acknowledged: false }],
  };
}
function opened(store: NutritionStore) {
  const state = store.getSnapshot();
  return {
    data: {
      mealTypes: state.data.mealTypes,
      foods: state.data.foods,
      meals: state.data.meals,
      days: state.data.days,
      checkins: state.data.checkins,
      answers: state.data.answers,
      mealStatuses: state.data.mealStatuses,
    },
    loaded: [...state.loaded].sort(),
    savedAt: state.savedAt,
    operations: state.operations,
  };
}

test('the #3096 shape moves across in one transaction, removing it last, and nothing is lost', async (t) => {
  const { scope, saved } = await open(t);
  const expected = await savedAs3096(scope);
  const server = historyServer();
  server.state.offline = true;
  const recorded = spy(scope);
  const store = make(recorded.storage, server.connection);
  await store.initialize();
  assert.deepEqual(opened(store), expected);
  assert.equal(recorded.writes.length, 1, 'one transaction');
  const keys = recorded.writes[0].keys;
  assert.ok(!keys.some((key) => key.startsWith('nutrition-photo.v1:')), 'photos stay in place');
  const firstRemoval = keys.findIndex((key) => key.startsWith('nutrition-day.v1:'));
  assert.ok(firstRemoval > keys.indexOf('nutrition-records.v3'), 'old shape removed last');
  assert.deepEqual(
    saved()
      .map((row) => row.key)
      .filter((key) => /records\.v2|day\.v1:/.test(key)),
    [],
  );
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.deepEqual(opened(reopened), expected);
  assert.equal(reopened.view(anchor).logs.length, 11, 'the pending log still overlays');
});

test('a move killed at any point leaves records that open intact and finish moving', async (t) => {
  const probe = await open(t);
  await savedAs3096(probe.scope);
  const recorded = spy(probe.scope);
  const server = historyServer();
  server.state.offline = true;
  await make(recorded.storage, server.connection).initialize();
  const steps = recorded.writes[0].keys.length;
  for (let killAt = 0; killAt < steps; killAt++) {
    const { scope, saved } = await open(t);
    const expected = await savedAs3096(scope);
    // Without a transaction, the app dies after `killAt` of the move's writes.
    let done = 0;
    const dying: ScopedStorage = {
      get: scope.get,
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
    assert.deepEqual(opened(reopened), expected, `killed after ${killAt} writes`);
    assert.deepEqual(
      saved()
        .map((row) => row.key)
        .filter((key) => /records\.v[12]|day\.v1:/.test(key)),
      [],
      `killed after ${killAt} writes`,
    );
  }
});

test('a move whose transaction fails part-way changes nothing and moves on the next launch', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  let failing = false;
  let writes = 0;
  const storage = await createLocalStorage({
    ...db.database,
    runAsync: async (sql, ...params) => {
      if (failing && sql.startsWith('INSERT') && ++writes === 3) {
        throw new Error('killed');
      }
      return db.database.runAsync(sql, ...params);
    },
  });
  const scope = storage.account(origin, 'one');
  const expected = await savedAs3096(scope);
  const before = db.connection.prepare('SELECT key, value FROM local_values ORDER BY key').all();
  failing = true;
  const server = historyServer();
  server.state.offline = true;
  const first = make(scope, server.connection);
  await first.initialize();
  assert.deepEqual(opened(first), expected);
  assert.deepEqual(
    db.connection.prepare('SELECT key, value FROM local_values ORDER BY key').all(),
    before,
  );
  failing = false;
  const second = make(scope, server.connection);
  await second.initialize();
  assert.deepEqual(opened(second), expected);
  const keys = (
    db.connection.prepare('SELECT key FROM local_values').all() as { key: string }[]
  ).map((row) => row.key);
  assert.ok(keys.includes('nutrition-records.v3'));
  assert.ok(!keys.includes('nutrition-records.v2'));
});

test('a missing food library stops the records opening and leaves them untouched', async (t) => {
  const { scope } = await open(t);
  const server = historyServer();
  await fullHistory(make(scope, server.connection), 2);
  const core = await scope.get('nutrition-records.v3');
  await scope.remove('nutrition-library.v1');
  const reopened = make(scope, server.connection);
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().ready, false);
  assert.equal(await scope.get('nutrition-records.v3'), core);
});
