import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NutritionStore,
  emptyNutrition,
  nutritionView,
} from '../src/features/nutrition/data/NutritionStore.ts';
import {
  scaledLog,
  foodSchema,
  mealTypeSchema,
  supplementSchema,
  mealSchema,
} from '../src/features/nutrition/data/models.ts';
import {
  ingredientItems,
  scanRecipe,
  recipeTotals,
} from '../src/features/nutrition/data/recipes.ts';
import { mealLabelArtwork } from '../src/features/nutrition/data/meal-label.ts';
import { decodeMealLabelScan } from '@trainingai/shared/nutrition/label-payload';
import {
  confirmedCreate,
  UnconfirmedCreate,
} from '../src/features/nutrition/data/confirmed-create.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { ApiError } from '../src/features/account/api/client.ts';
const date = '2026-10-11';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mealType = mealTypeSchema.parse({
  id: id(100),
  name: 'Lunch',
  emoji: '🥗',
  sortOrder: 0,
  timeStartHour: 11,
  timeEndHour: 15,
  required: true,
  remindersEnabled: false,
});
const food = foodSchema.parse({
  id: id(101),
  name: 'Rice',
  source: 'manual',
  servingSizeG: 100,
  calories: 130,
  proteinG: 2,
  carbsG: 29,
  fatG: 1,
});
function fixture() {
  const disk = new Map<string, string>();
  let seq = 1;
  let online = true;
  let lost = false;
  let readFails = false;
  let diskFails = false;
  const foods = [food];
  const logs: ReturnType<typeof scaledLog>[] = [];
  const mealChoices = new Map<
    string,
    { date: string; mealTypeId: string; skipped: boolean; decisionId: string }
  >();
  const mealTypes = [mealType];
  const applied = new Set<string>();
  const sent: { id: string; domain: string; date: string; payload: Record<string, unknown> }[] =
    [];
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (diskFails) {
        throw new Error('disk full');
      }
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string, query?: Record<string, string>): Promise<unknown> => {
      if (!online || readFails) {
        throw new Error('offline');
      }
      return path.endsWith('meal-types')
        ? mealTypes.slice()
        : path.endsWith('food-items')
          ? foods.slice()
          : path.endsWith('food-logs')
            ? logs.slice()
            : path.endsWith('targets')
              ? {}
              : path.endsWith('plan-meal-answers')
                ? { answers: [] }
                : path.endsWith('meal-statuses')
                  ? {
                      date: query?.date ?? date,
                      statuses: [...mealChoices.values()].filter(
                        (choice) => choice.date === (query?.date ?? date),
                      ),
                    }
                  : [];
    },
    post: async (_path: string, body: unknown) => {
      if (!online) {
        throw new Error('offline');
      }
      if (_path.endsWith('meal-statuses')) {
        const choice = body as {
          date: string;
          mealTypeId: string;
          skipped: boolean;
          decisionId: string;
        };
        mealChoices.set(`${choice.date}:${choice.mealTypeId}`, choice);
        return { success: true };
      }
      const op = (body as { mutations: typeof sent }).mutations[0];
      sent.push(op);
      if (!applied.has(op.id)) {
        applied.add(op.id);
        if (op.domain === 'food_items') {
          foods.push(foodSchema.parse(op.payload));
        }
        if (op.domain === 'food_logs') {
          const found = logs.findIndex((x) => x.id === op.payload.id);
          if (found >= 0) {
            logs.splice(found, 1);
          }
          if (!op.payload.deleted) {
            logs.push(
              scaledLog(foods.find((x) => x.id === op.payload.foodItemId)!, {
                ...op.payload,
                date: op.date,
              } as Parameters<typeof scaledLog>[1]),
            );
          }
        }
      }
      if (lost) {
        lost = false;
        throw new Error('reply lost');
      }
      return { processed: 1, errors: [] };
    },
  };
  const make = () =>
    new NutritionStore(
      storage,
      connection,
      () => id(seq++),
      () => {},
      () => Date.parse(date + 'T03:00:00Z'),
    );
  return {
    disk,
    storage,
    connection,
    foods,
    mealTypes,
    logs,
    sent,
    make,
    online: (v: boolean) => {
      online = v;
    },
    lost: () => {
      lost = true;
    },
    failRead: (v: boolean) => {
      readFails = v;
    },
    failDisk: (v: boolean) => {
      diskFails = v;
    },
  };
}
async function ready(f: ReturnType<typeof fixture>) {
  const store = f.make();
  await store.initialize();
  await store.refresh('mealTypes', date);
  await store.refresh('logs', date);
  return store;
}
test('nutrition queues food before its log and survives reopening offline', async () => {
  const f = fixture();
  const store = await ready(f);
  f.online(false);
  await store.logFoods(
    [{ ...food, id: undefined, quantityMultiplier: 1.5 }],
    date,
    mealType.id,
  );
  await store.sync();
  assert.equal(store.view(date).logs.length, 1);
  assert.equal(store.getSnapshot().operations.length, 2);
  store.cancel();
  const restored = f.make();
  await restored.initialize();
  assert.equal(restored.view(date).totals?.calories, 195);
  f.online(true);
  await restored.sync();
  assert.equal(f.logs.length, 1);
  assert.equal(restored.getSnapshot().operations.length, 0);
  assert.deepEqual(
    f.sent.map((x) => x.domain),
    ['food_items', 'food_logs'],
  );
});

test('meal statuses default to unknown and skip choices survive reopening offline', async () => {
  const f = fixture();
  const store = await ready(f);
  assert.equal(store.view(date).mealStatuses[mealType.id], 'not_recorded');
  assert.equal(store.view(date).loggingComplete, false);
  f.online(false);
  await store.setMealSkipped(mealType.id, date, true);
  assert.equal(store.view(date).mealStatuses[mealType.id], 'skipped');
  store.cancel();
  const reopened = f.make();
  await reopened.initialize();
  assert.equal(reopened.view(date).mealStatuses[mealType.id], 'skipped');
  assert.equal(reopened.view('2026-10-12').mealStatuses[mealType.id], 'not_recorded');
  await reopened.setMealSkipped(mealType.id, date, false);
  assert.equal(reopened.view(date).mealStatuses[mealType.id], 'not_recorded');
  await reopened.sync();
  f.online(true);
  await reopened.sync();
  assert.equal(reopened.getSnapshot().http.length, 0, reopened.getSnapshot().error ?? '');
});

test('recording after a skip clears it, and deleting the food returns the meal to unknown', async () => {
  const f = fixture();
  const store = await ready(f);
  f.online(false);
  await store.setMealSkipped(mealType.id, date, true);
  await store.logFoods([{ ...food, quantityMultiplier: 1 }], date, mealType.id);
  assert.equal(store.view(date).mealStatuses[mealType.id], 'recorded');
  await assert.rejects(store.setMealSkipped(mealType.id, date, true), /recorded food/);
  await store.removeLogs(store.view(date).logs);
  assert.equal(store.view(date).mealStatuses[mealType.id], 'not_recorded');
  await store.sync();
  f.online(true);
  await store.sync();
  assert.equal(store.getSnapshot().http.length, 0);
  assert.equal(store.view(date).mealStatuses[mealType.id], 'not_recorded');
});

test('an unknown breakfast keeps the day incomplete even when lunch is recorded', async () => {
  const f = fixture();
  const lunch = { ...mealType, id: id(101), name: 'Lunch', required: false };
  f.mealTypes.push(lunch);
  const store = await ready(f);
  f.online(false);
  await store.logFoods([{ ...food, quantityMultiplier: 1 }], date, lunch.id);
  assert.equal(store.view(date).loggingComplete, false);
  await store.setMealSkipped(mealType.id, date, true);
  assert.equal(store.view(date).loggingComplete, true);
  await store.setMealSkipped(mealType.id, date, false);
  assert.equal(store.view(date).loggingComplete, false);
});

test('a failed local save does not claim that the meal was skipped', async () => {
  const f = fixture();
  const store = await ready(f);
  f.failDisk(true);
  await assert.rejects(store.setMealSkipped(mealType.id, date, true));
  assert.equal(store.view(date).mealStatuses[mealType.id], 'not_recorded');
});

test('an older server retains meal choices locally without blocking other preference writes', async () => {
  const f = fixture();
  let targets: unknown = {};
  const store = new NutritionStore(
    f.storage,
    {
      ...f.connection,
      get: (path, query) =>
        path.endsWith('targets') ? Promise.resolve(targets) : f.connection.get(path, query),
      post: (path, body) =>
        path.endsWith('meal-statuses')
          ? Promise.reject(new ApiError(404))
          : f.connection.post(path, body),
      put: async (_path, body) => {
        targets = body;
        return body;
      },
    },
    (() => {
      let seq = 900;
      return () => id(seq++);
    })(),
  );
  await store.initialize();
  await store.refresh('mealTypes', date);
  await store.refresh('logs', date);
  await store.setMealSkipped(mealType.id, date, true);
  await store.queueHttp('targets', date, { proteinG: 80 });
  await store.sync();
  assert.equal(store.view(date).mealStatuses[mealType.id], 'skipped');
  assert.equal(store.view(date).targets.proteinG, 80);
  assert.equal(store.getSnapshot().http.length, 1);
  assert.equal(store.getSnapshot().http[0].kind, 'meal-status');
  assert.equal(store.getSnapshot().error, null);
});

test('unavailable meal-status syncing does not report an app failure or lose cached food logs', async () => {
  const f = fixture();
  const store = await ready(f);
  await store.logFoods([{ ...food, quantityMultiplier: 1 }], date, mealType.id);
  await store.sync();
  const get = f.connection.get;
  f.connection.get = (path, query) =>
    path.endsWith('meal-statuses')
      ? Promise.reject(new ApiError(404))
      : path.endsWith('targets')
        ? Promise.reject(new ApiError(502))
        : get(path, query);
  await store.refresh('targets', date, true);
  await store.refresh('mealStatuses', date, true);
  assert.equal(store.getSnapshot().errors[`mealStatuses:${date}`], undefined);
  assert.match(store.getSnapshot().errors.targets, /nutrition goals.*502/);
  assert.equal(store.view(date).logs.length, 1);
  assert.equal(store.getSnapshot().denied, false);
  await store.refresh('logs', date, true);
  assert.equal(store.view(date).logs.length, 1);
  f.connection.get = get;
  await store.refresh('mealStatuses', date, true);
  assert.equal(store.getSnapshot().errors[`mealStatuses:${date}`], undefined);
});

test('refresh failures identify the resource and service status while retaining saved goals', async () => {
  const f = fixture();
  const get = f.connection.get;
  f.connection.get = (path, query) =>
    path.endsWith('targets') ? Promise.resolve({ calories: 2000 }) : get(path, query);
  const store = await ready(f);
  await store.refresh('targets', date);
  f.connection.get = async () => {
    throw new ApiError(502);
  };
  await store.refresh('targets', date, true);
  assert.match(store.getSnapshot().errors.targets, /nutrition goals.*502/);
  assert.equal(store.view(date).targets.calories, 2000);
  f.connection.get = async () => ({ calories: 'unreadable' });
  await store.refresh('targets', date, true);
  assert.match(store.getSnapshot().errors.targets, /unreadable nutrition goals/);
  assert.equal(store.view(date).targets.calories, 2000);
});
test('lost replies replay stable mutation IDs without duplicating food logs', async () => {
  const f = fixture();
  const store = await ready(f);
  f.lost();
  await store.logFoods([{ ...food, quantityMultiplier: 1 }], date, mealType.id);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 1);
  await store.sync();
  assert.equal(f.logs.length, 1);
  assert.equal(f.sent[0].id, f.sent[1].id);
  assert.equal(store.getSnapshot().operations.length, 0);
});
test('acknowledged upload is retained until canonical readback succeeds', async () => {
  const f = fixture();
  const store = await ready(f);
  f.failRead(true);
  await store.logFoods([{ ...food, quantityMultiplier: 1 }], date, mealType.id);
  await store.sync();
  assert.equal(store.getSnapshot().operations[0].acknowledged, true);
  assert.equal(f.sent.length, 1);
  f.failRead(false);
  await store.sync();
  assert.equal(f.sent.length, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
});
test('failed local batch append publishes neither ingredients nor recipe', async () => {
  const f = fixture();
  const store = await ready(f);
  f.failDisk(true);
  await assert.rejects(
    store.saveMeal(
      {
        name: 'Rice bowl',
        servings: 2,
        items: [{ foodItemId: id(200), quantityMultiplier: 3 }],
      },
      date,
      [{ ...food, id: id(200), quantityMultiplier: 1 }],
    ),
  );
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.view(date).meals.length, 0);
});
test('group serving edits preserve occurrence and food identity', async () => {
  const f = fixture();
  const store = await ready(f);
  await store.logFoods(
    [
      { ...food, quantityMultiplier: 1 },
      { ...food, quantityMultiplier: 2 },
    ],
    date,
    mealType.id,
    { name: 'Rice bowl' },
  );
  await store.sync();
  const before = store.view(date).logs;
  f.online(false);
  await store.editGroup(before, 2, mealType.id);
  await store.sync();
  const after = store.view(date).logs;
  assert.deepEqual(
    after.map((x) => x.id),
    before.map((x) => x.id),
  );
  assert.equal(after[0].mealGroupId, before[0].mealGroupId);
  assert.equal(after[0].loggedAt, before[0].loggedAt);
  assert.equal(after[1].quantityMultiplier, 4);
});
test('an unknown food day never becomes a zero-calorie day', () => {
  assert.equal(nutritionView(emptyNutrition, date).totals, null);
  assert.equal(
    nutritionView({ ...emptyNutrition, loaded: ['logs:' + date] }, date).totals?.calories,
    0,
  );
});
test('unchecking a supplement removes only its manual contribution', () => {
  const supplement = supplementSchema.parse({
    id: id(120),
    name: 'Protein',
    dose: null,
    defaultAmount: 30,
    unit: 'g',
    active: true,
    sortOrder: 0,
    reminderEnabled: false,
    reminderTime: null,
    loggedToday: true,
    loggedDose: { amount: 30, unit: 'g', doseText: null },
    loggedAmount: { amount: 40, unit: 'g', contributions: 2 },
  });
  const state = {
    ...emptyNutrition,
    data: { ...emptyNutrition.data, supplementDate: date, supplements: [supplement] },
    operations: [
      {
        id: id(1),
        domain: 'supplement_logs' as const,
        date,
        payload: { supplementId: supplement.id, logDate: date, deleted: true },
        acknowledged: false,
      },
    ],
  };
  const view = nutritionView(state, date);
  assert.equal(view.supplements[0].loggedToday, false);
  assert.equal(view.supplements[0].loggedAmount?.amount, 10);
  assert.equal(view.supplements[0].loggedAmount?.contributions, 1);
});
test('wrong-account or corrupt saved records are preserved and cannot be overwritten', async () => {
  const f = fixture();
  f.disk.set('nutrition-records.v1', '{broken');
  const store = f.make();
  await store.initialize();
  assert.equal(store.getSnapshot().ready, false);
  await assert.rejects(store.enqueue([{ domain: 'food_items', date, payload: food }]));
  assert.equal(f.disk.get('nutrition-records.v1'), '{broken');
});
test('authorization denial hides cached nutrition and stops writes', async () => {
  const f = fixture();
  const store = await ready(f);
  f.connection.get = async () => {
    throw new ApiError(403, 'inactive_account');
  };
  await store.refresh('logs', date, true);
  assert.equal(store.getSnapshot().denied, true);
  assert.equal(store.view(date).mealTypes.length, 0);
  await assert.rejects(store.logFoods([{ ...food, quantityMultiplier: 1 }], date, mealType.id));
});
test('food identity reuse preserves quantities and does not add duplicate library rows', async () => {
  const f = fixture();
  const store = await ready(f);
  await store.refresh('foods', date);
  await store.logFoods([{ ...food, id: undefined, quantityMultiplier: 2 }], date, mealType.id);
  await store.sync();
  assert.equal(f.foods.length, 1);
  assert.deepEqual(
    f.sent.map((x) => x.domain),
    ['food_logs'],
  );
  assert.equal(f.logs[0].foodItemId, food.id);
  assert.equal(f.logs[0].quantityMultiplier, 2);
});
test('recipe readback compares an unordered ingredient multiset and retains portion math', async () => {
  const f = fixture();
  const second = { ...food, id: id(201), name: 'Second food' };
  f.foods.push(second);
  let saved: ReturnType<typeof mealSchema.parse>[] = [];
  const originalGet = f.connection.get;
  const originalPost = f.connection.post;
  f.connection.get = async (path) => (path.endsWith('saved-meals') ? saved : originalGet(path));
  f.connection.post = async (path, body) => {
    const op = (body as { mutations: { payload: Record<string, unknown>; domain: string }[] })
      .mutations[0];
    if (op.domain === 'saved_meals') {
      const p = op.payload as {
        id: string;
        name: string;
        servings: number;
        items: { foodItemId: string; quantityMultiplier: number }[];
      };
      const items = p.items
        .slice()
        .reverse()
        .map((i) => ({ ...i, foodItem: f.foods.find((x) => x.id === i.foodItemId)! }));
      saved = [mealSchema.parse({ ...p, items, totals: recipeTotals(p.items, f.foods) })];
      return { processed: 1, errors: [] };
    }
    return originalPost(path, body);
  };
  const store = await ready(f);
  await store.refresh('foods', date);
  await store.saveMeal(
    {
      name: 'Rice meal',
      servings: 3,
      items: [
        { foodItemId: food.id, quantityMultiplier: 1.5 },
        { foodItemId: second.id, quantityMultiplier: 2 },
      ],
    },
    date,
  );
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.view(date).meals[0].servings, 3);
  assert.equal(store.view(date).meals[0].totals.calories, 455);
});
test('an imported recipe restores whole-batch ingredients from a per-serving scan', () => {
  const scan = {
    name: 'Rice recipe',
    servingSizeG: 100,
    calories: 130,
    proteinG: 2,
    carbsG: 29,
    fatG: 1,
    ingredients: [
      {
        name: 'Rice',
        weightG: 100,
        caloriesPer100g: 130,
        proteinPer100g: 2,
        carbsPer100g: 29,
        fatPer100g: 1,
      },
    ],
  };
  const draft = scanRecipe(scan, 4, () => id(200));
  assert.equal(draft.items[0].quantityMultiplier, 4);
  assert.equal(recipeTotals(draft.items, []).calories, 520);
  assert.equal(Number(draft.servings), 4);
});
test('tiny recipe ingredients remain writable without rounding their weight up to a gram', () => {
  const items = ingredientItems(
    [
      {
        name: 'Salt',
        weightG: 0.1,
        caloriesPer100g: 0,
        proteinPer100g: 0,
        carbsPer100g: 0,
        fatPer100g: 0,
      },
    ],
    1,
    () => id(200),
  );
  assert.ok(items[0].quantityMultiplier >= 0.01);
  assert.equal(items[0].quantityMultiplier * items[0].food!.servingSizeG, 0.1);
});
test('own-label and shared-recipe codes retain distinct contracts and per-portion figures', () => {
  const meal = mealSchema.parse({
    id: id(300),
    name: 'Rice recipe',
    servings: 4,
    items: [{ foodItemId: food.id, quantityMultiplier: 4, foodItem: food }],
    totals: { calories: 520, proteinG: 8, carbsG: 116, fatG: 4 },
  });
  const own = mealLabelArtwork(meal, 'inlineCentred');
  assert.deepEqual(decodeMealLabelScan(own.payload.text), { kind: 'meal-id', mealId: meal.id });
  assert.match(own.svg, />130<\/text>/);
  const shared = mealLabelArtwork(meal, 'share');
  const decoded = decodeMealLabelScan(shared.payload.text);
  assert.equal(decoded?.kind, 'shared-meal');
  if (decoded?.kind === 'shared-meal') {
    assert.equal(decoded.meal.servings, 4);
    assert.equal(
      decoded.meal.ingredients.reduce((sum, i) => sum + i.calories, 0),
      520,
    );
  }
  assert.ok(own.metrics.mmPerModule >= 0.49);
  assert.ok(shared.metrics.mmPerModule >= 0.49);
});
test('HTTP requests are validated before appending and completion dates cannot drift', async () => {
  const f = fixture();
  const store = await ready(f);
  await assert.rejects(store.queueHttp('targets', date, { calories: -100 }));
  await assert.rejects(
    store.queueHttp('complete', date, { date: '2026-10-12', complete: true }),
  );
  assert.equal(store.getSnapshot().http.length, 0);
});
test('a lost non-idempotent create response is recovered from the saved list without a second POST', async () => {
  const f = fixture();
  let rows: { id: string; name: string }[] = [];
  let posts = 0;
  const resources = new WorkoutResources(f.storage, {
    ...f.connection,
    post: async () => {
      posts++;
      rows.push({ id: id(200), name: 'Plan' });
      throw new Error('reply lost');
    },
  });
  const list = async () => rows;
  const match = (row: (typeof rows)[number], body: Record<string, unknown>) =>
    row.name === body.name;
  await assert.rejects(
    confirmedCreate(resources, '/api/nutrition/meal-plans', { name: 'Plan' }, list, match),
  );
  const recovered = await confirmedCreate(
    resources,
    '/api/nutrition/meal-plans',
    { name: 'Plan' },
    list,
    match,
  );
  assert.equal(recovered.id, id(200));
  assert.equal(posts, 1);
});
test('an uncertain create cannot silently re-POST when no canonical row is visible', async () => {
  const f = fixture();
  let posts = 0;
  const resources = new WorkoutResources(f.storage, {
    ...f.connection,
    post: async () => {
      posts++;
      throw new Error('offline');
    },
  });
  const save = () =>
    confirmedCreate(
      resources,
      '/api/nutrition/meal-plans',
      { name: 'Plan' },
      async () => [] as { id: string; name: string }[],
      () => true,
    );
  await assert.rejects(save());
  await assert.rejects(save(), UnconfirmedCreate);
  assert.equal(posts, 1);
});
