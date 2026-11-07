import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import { foodSchema, mealTypeSchema, scaledLog, type Food } from '../src/features/nutrition/data/models.ts';
import { savedBarcodeFood } from '../src/features/nutrition/data/scan-response.ts';
import {
  librarySearch,
  recentFoods,
  savedFoodForBarcode,
} from '../src/features/nutrition/data/food-library.ts';
import { keeperItems } from '../src/features/nutrition/data/retired-foods.ts';

// #3652: after a look-alike merge, the merged-away food is never offered or logged from a stale
// copy; its keeper stands in. #3651: search and the barcode check reach the whole library.
const date = '2026-11-06';
let seq = 1;
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lunch = mealTypeSchema.parse({
  id: id(100),
  name: 'Lunch',
  emoji: '🥗',
  sortOrder: 0,
  timeStartHour: 11,
  timeEndHour: 15,
  required: true,
  remindersEnabled: false,
});
const BARCODE = '9300675024235';
const beans = (n: number, servingSizeG: number, barcode?: string) =>
  foodSchema.parse({
    id: id(n),
    name: 'Baked beans',
    brand: 'Tin Co',
    source: 'barcode',
    servingSizeG,
    calories: servingSizeG,
    proteinG: 5,
    carbsG: 15,
    fatG: 1,
    ...(barcode ? { barcode } : {}),
  });
// The extra the merge retires (50 g serving, carried the barcode), and its keeper (100 g, filled).
const extra = beans(101, 50, BARCODE);
const keeper = beans(102, 100, BARCODE);
const rice = foodSchema.parse({
  id: id(103),
  name: 'Rice',
  source: 'manual',
  servingSizeG: 100,
  calories: 130,
  proteinG: 2,
  carbsG: 29,
  fatG: 1,
});
const logOn = (food: Food, n: number, day = '2026-10-20') =>
  scaledLog(food, {
    id: id(n),
    date: day,
    mealTypeId: lunch.id,
    foodItemId: food.id,
    quantityMultiplier: 1,
    loggedAt: day + 'T02:00:00.000Z',
  } as Parameters<typeof scaledLog>[1]);

function fixture(opts: { retiredAnswer?: boolean } = {}) {
  const disk = new Map<string, string>();
  const days: Record<string, ReturnType<typeof scaledLog>[]> = { '2026-10-20': [logOn(extra, 900)] };
  const asked: (Record<string, string> | undefined)[] = [];
  const sent: { domain: string; payload: Record<string, unknown> }[] = [];
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
      if (path.endsWith('/retired')) {
        asked.push(query);
        return opts.retiredAnswer === false
          ? { retired: [], keepers: [], at: '2026-11-06T03:00:00.000Z' }
          : { retired: [{ id: extra.id, deletedAt: '2026-11-05T02:00:00.000Z' }], keepers: [keeper], at: '2026-11-06T03:00:00.000Z' };
      }
      if (path.endsWith('meal-types')) return [lunch];
      if (path.endsWith('food-items')) return [rice];
      if (path.endsWith('food-logs')) return days[query?.date ?? date] ?? [];
      if (path.endsWith('plan-meal-answers')) return { answers: [] };
      if (path.endsWith('meal-statuses')) return { date, statuses: [] };
      return [];
    },
    post: async (path: string, body: unknown) => {
      if (path.endsWith('meal-statuses')) return { success: true };
      for (const op of (body as { mutations: typeof sent }).mutations) sent.push(op);
      return { processed: 1, errors: [] };
    },
  };
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => void disk.set(key, value),
    remove: async (key: string) => void disk.delete(key),
  };
  const make = () =>
    new NutritionStore(storage, connection, () => id(1000 + seq++), () => {}, () =>
      Date.parse(date + 'T03:00:00Z'),
    );
  return { disk, asked, sent, make, connection };
}
async function opened(f: ReturnType<typeof fixture>) {
  const store = f.make();
  await store.initialize();
  await store.refresh('mealTypes', date);
  // The saved day read before the merge: its log still points at the extra.
  await store.refresh('logs', '2026-10-20');
  await store.refresh('logs', date);
  await store.refresh('foods', date, true);
  return store;
}

test('a merged-away food on a saved day is not offered; its keeper is, and the barcode resolves to it', async () => {
  const store = await opened(fixture());
  const view = store.view(date);
  assert.deepEqual(view.retiredFoodIds, [extra.id]);
  assert.equal(view.foods.some((f) => f.id === extra.id), false);
  assert.ok(view.foods.some((f) => f.id === keeper.id));
  assert.equal(savedBarcodeFood(view.foods, BARCODE)?.id, keeper.id);
  // The saved day still draws its log from the retired copy.
  assert.equal(store.view('2026-10-20').logs[0].foodItem.id, extra.id);
});

test('without the retired list, the stale copy is still offered (the bug)', async () => {
  const store = await opened(fixture({ retiredAnswer: false }));
  const view = store.view(date);
  assert.equal(savedBarcodeFood(view.foods, BARCODE)?.id, extra.id);
});

test('duplicating a log of the merged-away food lands on the keeper in the same grams', async () => {
  const store = await opened(fixture());
  const stale = store.view('2026-10-20').logs[0];
  await store.logFoods([{ ...stale.foodItem, quantityMultiplier: 3 }], date, lunch.id);
  const op = store.getSnapshot().operations.find((o) => o.domain === 'food_logs');
  assert.equal(op?.payload.foodItemId, keeper.id);
  // 3 × 50 g = 150 g = 1.5 × the keeper's 100 g.
  assert.equal(op?.payload.quantityMultiplier, 1.5);
  assert.equal(store.getSnapshot().operations.some((o) => o.domain === 'food_items'), false);
});

test('undo restoring a log on the merged-away food does not put it back in the library', async () => {
  const store = await opened(fixture());
  const stale = store.view('2026-10-20').logs[0];
  await store.restoreLogs([stale]);
  assert.equal(store.getSnapshot().data.foods.some((f) => f.id === extra.id), false);
  assert.equal(store.view(date).foods.some((f) => f.id === extra.id), false);
});

test('a phone that never kept the retired list reads retirements from the beginning once', async () => {
  const f = fixture();
  const store = await opened(f);
  assert.deepEqual(f.asked, [undefined]);
  // A store persisted before #3652: a cursor, but no list.
  for (const [key, value] of f.disk) {
    if (!value.includes('foodsRetiredAt')) continue;
    const saved = JSON.parse(value);
    if (!saved.data) continue;
    delete saved.data.retiredFoodIds;
    f.disk.set(key, JSON.stringify(saved));
  }
  const reopened = f.make();
  await reopened.initialize();
  await reopened.refresh('foods', date, true);
  assert.deepEqual(f.asked, [undefined, undefined]);
  await reopened.refresh('foods', date, true);
  assert.deepEqual(f.asked.at(-1), { since: '2026-11-06T03:00:00.000Z' });
  void store;
});

test('library search adds the server’s matches, once each, and never a retired food', () => {
  const retired = new Set([extra.id]);
  const local = [rice, keeper];
  const old = { ...rice, id: id(104), name: 'Rice cakes' };
  assert.deepEqual(
    librarySearch(local, [old, rice, extra], 'rice', retired).map((f) => f.id),
    [rice.id, old.id],
  );
  assert.deepEqual(librarySearch(local, [extra], 'beans', retired).map((f) => f.id), [keeper.id]);
  assert.deepEqual(recentFoods([extra, rice, keeper], local, retired).map((f) => f.id), [keeper.id, rice.id]);
});

test('a barcode resolves on the phone, then anywhere in the library, before the food database', async () => {
  const retired = new Set([extra.id]);
  const old = { ...rice, id: id(105), barcode: '9300000000011' };
  const asked: Record<string, string>[] = [];
  const server = (answer: () => unknown) => ({
    get: async (_path: string, query?: Record<string, string>) => {
      asked.push(query!);
      return answer();
    },
  });
  // On the phone: no request.
  assert.equal((await savedFoodForBarcode(server(() => []), [keeper], BARCODE, retired))?.id, keeper.id);
  assert.equal(asked.length, 0);
  // Older than the phone's cache: the server has it.
  assert.equal((await savedFoodForBarcode(server(() => [old]), [rice], '9300000000011', retired))?.id, old.id);
  assert.deepEqual(asked.at(-1), { barcode: '9300000000011' });
  // An older server that ignores `barcode`, a retired row, or no answer: on to the food database.
  assert.equal(await savedFoodForBarcode(server(() => [rice]), [], '9300000000011', retired), null);
  assert.equal(await savedFoodForBarcode(server(() => [extra]), [], BARCODE, retired), null);
  assert.equal(
    await savedFoodForBarcode(server(() => { throw new Error('offline'); }), [], BARCODE, retired),
    null,
  );
});

test('a saved meal read before the merge edits onto the keeper in the same grams', () => {
  const retired = new Set([extra.id]);
  assert.deepEqual(
    keeperItems(
      [
        { foodItemId: extra.id, quantityMultiplier: 2, foodItem: extra },
        { foodItemId: rice.id, quantityMultiplier: 1, foodItem: rice },
      ],
      [rice, keeper],
      retired,
    ),
    [
      { foodItemId: keeper.id, quantityMultiplier: 1 },
      { foodItemId: rice.id, quantityMultiplier: 1 },
    ],
  );
  // No keeper on the phone: left as it was.
  assert.deepEqual(keeperItems([{ foodItemId: extra.id, quantityMultiplier: 2, foodItem: extra }], [rice], retired), [
    { foodItemId: extra.id, quantityMultiplier: 2 },
  ]);
});
