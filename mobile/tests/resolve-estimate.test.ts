import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import { foodSchema, mealTypeSchema, scaledLog } from '../src/features/nutrition/data/models.ts';
import {
  ateAssumed,
  ateOtherPlanMeal,
  ateUsualFood,
  skipAssumed,
  slotOf,
  type Slot,
} from '../src/features/meal-plans/data/resolve-estimate.ts';
import { estimatedMeals, type PlanMeal } from '../src/features/meal-plans/data/estimated-meals.ts';

const date = '2026-10-26';
let counter = 1;
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = () => id(counter++);
const lunch = mealTypeSchema.parse({
  id: id(100),
  name: 'Lunch',
  emoji: '🥗',
  sortOrder: 0,
  timeStartHour: 11,
  timeEndHour: 15,
  required: true,
  remindersEnabled: true,
});
const ingredient = (name: string) => ({
  name,
  weightG: 200,
  caloriesPer100g: 130,
  proteinPer100g: 2,
  carbsPer100g: 28,
  fatPer100g: 0.3,
});
const bowl = {
  id: id(500),
  position: 0,
  name: 'Chicken rice bowl',
  mealTypeId: lunch.id,
  suggestedTime: '12:30',
  targetCalories: 620,
  targetProteinG: 40,
  targetCarbsG: 70,
  targetFatG: 15,
  ingredients: [ingredient('Chicken'), ingredient('Rice')],
} as PlanMeal;
const soup = { ...bowl, id: id(501), name: 'Lentil soup', mealTypeId: null, ingredients: [ingredient('Lentils')] } as PlanMeal;
const wrap = foodSchema.parse({
  id: id(101),
  name: 'Tuna salad wrap',
  source: 'manual',
  servingSizeG: 100,
  calories: 480,
  proteinG: 30,
  carbsG: 40,
  fatG: 12,
});

/** The server as the store sees it: one estimated answer, and what each pushed change does to it. */
function fixture() {
  const disk = new Map<string, string>();
  const answers: Record<string, unknown>[] = [
    { id: id(900), planMealId: bowl.id, logDate: date, answer: 'estimated', estCalories: 620 },
  ];
  const foods = [wrap];
  const logs: ReturnType<typeof scaledLog>[] = [];
  const sent: { domain: string; payload: Record<string, unknown> }[] = [];
  let online = true;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string): Promise<unknown> => {
      if (!online) throw new Error('offline');
      if (path.endsWith('meal-types')) return [lunch];
      if (path.endsWith('food-items')) return foods.slice();
      if (path.endsWith('food-logs')) return logs.slice();
      if (path.endsWith('plan-meal-answers')) return { answers: answers.slice() };
      if (path.endsWith('targets')) return {};
      if (path.endsWith('meal-statuses')) return { date, statuses: [] };
      return [];
    },
    post: async (path: string, body: unknown) => {
      if (!online) throw new Error('offline');
      if (path.endsWith('meal-statuses')) return { success: true };
      const op = (body as { mutations: typeof sent }).mutations[0];
      sent.push(op);
      if (op.domain === 'food_items') foods.push(foodSchema.parse(op.payload));
      if (op.domain === 'food_logs')
        logs.push(
          scaledLog(foods.find((f) => f.id === op.payload.foodItemId)!, {
            ...op.payload,
            date,
          } as Parameters<typeof scaledLog>[1]),
        );
      if (op.domain === 'plan_meal_answers') {
        const at = answers.findIndex((a) => a.planMealId === op.payload.planMealId);
        if (at >= 0) answers.splice(at, 1);
        if (!op.payload.deleted)
          answers.push({ id: id(901), planMealId: op.payload.planMealId, logDate: date, answer: 'no' });
      }
      return { processed: 1, errors: [] };
    },
  };
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => void disk.set(key, value),
    remove: async (key: string) => void disk.delete(key),
  };
  return {
    sent,
    answers,
    logs,
    online: (v: boolean) => (online = v),
    async store() {
      const store = new NutritionStore(storage, connection, uuid, () => {}, () =>
        Date.parse(date + 'T03:00:00Z'),
      );
      await store.initialize();
      for (const kind of ['mealTypes', 'foods', 'logs', 'answers'] as const)
        await store.refresh(kind, date);
      return store;
    },
  };
}
const context = (store: NutritionStore) => ({
  store,
  timezone: 'Australia/Brisbane',
  view: store.view(date),
});
function estimatedSlot(store: NutritionStore): Slot {
  const [row] = estimatedMeals({
    meals: [bowl],
    answers: store.view(date).answers,
    logs: store.view(date).logs,
    mealTypes: store.view(date).mealTypes,
  });
  assert.ok(row, 'the estimated meal is listed before it is answered');
  return slotOf(row);
}
const ingredientsOf = (logs: { foodItem: { name: string } }[]) => logs.map((l) => l.foodItem.name).sort();

test('"I ate this" logs the meal in its slot and clears the estimate in the same write', async () => {
  const f = fixture();
  const store = await f.store();
  const slot = estimatedSlot(store);
  f.online(false);
  await ateAssumed(context(store), slot, date, uuid);
  // Local copy is in step straight away, offline: the food is there and the row is gone.
  const view = store.view(date);
  assert.deepEqual(ingredientsOf(view.logs), ['Chicken', 'Rice']);
  assert.ok(view.logs.every((log) => log.mealTypeId === lunch.id));
  assert.equal(view.answers.some((a) => a.planMealId === bowl.id), false);
  const queued = store.getSnapshot().operations;
  assert.equal(queued.filter((op) => op.domain === 'plan_meal_answers').length, 1);
  assert.deepEqual(queued.find((op) => op.domain === 'plan_meal_answers')?.payload, {
    planMealId: bowl.id,
    logDate: date,
    deleted: true,
  });
  // Then it reaches the server, and the estimate is gone there too.
  f.online(true);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0, store.getSnapshot().error ?? '');
  assert.equal(f.answers.length, 0);
  assert.equal(f.logs.length, 2);
  assert.equal(f.sent.at(-1)?.domain, 'plan_meal_answers');
});

test('"I skipped it" is the existing "no" answer, and the row goes', async () => {
  const f = fixture();
  const store = await f.store();
  const slot = estimatedSlot(store);
  await skipAssumed(context(store), slot, date);
  await store.sync();
  assert.deepEqual(f.sent.map((op) => [op.domain, op.payload.deleted ?? false]), [['plan_meal_answers', false]]);
  assert.deepEqual(f.sent[0].payload, { planMealId: bowl.id, logDate: date });
  assert.equal(f.answers[0].answer, 'no');
  assert.equal(f.logs.length, 0);
  const view = store.view(date);
  assert.deepEqual(
    estimatedMeals({ meals: [bowl], answers: view.answers, logs: view.logs, mealTypes: view.mealTypes }),
    [],
  );
});

test('"I ate something else" from the usual foods logs one serving in the slot and clears the estimate', async () => {
  const f = fixture();
  const store = await f.store();
  await ateUsualFood(context(store), estimatedSlot(store), wrap, date);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0, store.getSnapshot().error ?? '');
  assert.deepEqual(ingredientsOf(f.logs), ['Tuna salad wrap']);
  assert.equal(f.logs[0].mealTypeId, lunch.id);
  assert.equal(f.logs[0].quantityMultiplier, 1);
  assert.equal(f.answers.length, 0);
});

test('"I ate something else" from the plan logs that meal under the estimated slot', async () => {
  const f = fixture();
  const store = await f.store();
  await ateOtherPlanMeal(context(store), estimatedSlot(store), soup, date, uuid);
  await store.sync();
  assert.deepEqual(ingredientsOf(f.logs), ['Lentils']);
  // The soup has no meal group of its own; it lands in the slot being answered.
  assert.equal(f.logs[0].mealTypeId, lunch.id);
  assert.equal(f.answers.length, 0);
});

test('a meal with no estimate yet is answered without clearing anything', async () => {
  const f = fixture();
  f.answers.length = 0;
  const store = await f.store();
  const slot: Slot = { meal: { ...bowl, id: bowl.id! }, mealTypeId: lunch.id, hasEstimate: false };
  await ateAssumed(context(store), slot, date, uuid);
  assert.equal(
    store.getSnapshot().operations.some((op) => op.domain === 'plan_meal_answers'),
    false,
  );
  await store.sync();
  assert.equal(f.logs.length, 2);
});

test('a meal with no ingredients cannot be logged, and nothing is written', async () => {
  const f = fixture();
  const store = await f.store();
  const slot = estimatedSlot(store);
  const bare = { ...slot, meal: { ...slot.meal, ingredients: [] } };
  await assert.rejects(ateAssumed(context(store), bare, date, uuid), /no ingredients/);
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.view(date).answers.length, 1);
});

test('without an account nothing is written', async () => {
  const slot: Slot = { meal: { ...bowl, id: bowl.id! }, mealTypeId: lunch.id, hasEstimate: true };
  const none = { store: null, timezone: 'UTC', view: { mealTypes: [] } };
  await assert.rejects(ateAssumed(none, slot, date, uuid), /Connect your account/);
  await assert.rejects(skipAssumed(none, slot, date), /Connect your account/);
  await assert.rejects(ateUsualFood(none, slot, wrap, date), /Connect your account/);
});
