import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NutritionStore } from '../src/features/nutrition/data/NutritionStore.ts';
import { mealTypeSchema, planSchema, scaledLog, foodSchema } from '../src/features/nutrition/data/models.ts';
import { materialisePlanEstimates } from '../src/features/meal-plans/data/plan-estimates.ts';
import { estimatedMeals, type PlanMeal } from '../src/features/meal-plans/data/estimated-meals.ts';

// #3650. Preview writes today's plan-meal estimates as the current app does, so an unlogged plan
// meal counts once its slot is over.
const date = '2026-10-26';
const tz = 'Australia/Brisbane';
// 16:00 in Brisbane: lunch (11–15, suggested 12:30) is over; dinner (17–21) is not.
const afternoon = Date.parse(date + 'T06:00:00Z');
let counter = 1;
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = () => id(counter++);
const type = (n: number, name: string, start: number, end: number) =>
  mealTypeSchema.parse({
    id: id(n),
    name,
    emoji: '🍽️',
    sortOrder: n,
    timeStartHour: start,
    timeEndHour: end,
    required: true,
    remindersEnabled: true,
  });
const lunch = type(100, 'Lunch', 11, 15);
const dinner = type(101, 'Dinner', 17, 21);
const meal = (n: number, name: string, mealTypeId: string, suggestedTime: string, kcal: number) => ({
  id: id(n),
  position: n,
  name,
  mealTypeId,
  suggestedTime,
  targetCalories: kcal,
  targetProteinG: 40,
  targetCarbsG: 60,
  targetFatG: 15,
  ingredients: [
    { name: name + ' base', weightG: 200, caloriesPer100g: 130, proteinPer100g: 2, carbsPer100g: 28, fatPer100g: 0.3 },
  ],
});
const bowl = meal(500, 'Chicken rice bowl', lunch.id, '12:30', 620);
const stew = meal(501, 'Beef stew', dinner.id, '18:30', 700);
const plan = (variants: { dayType: 'all' | 'training' | 'rest'; meals: ReturnType<typeof meal>[] }[]) =>
  planSchema.parse({
    id: id(600),
    name: 'Plan',
    targetCalories: 2000,
    targetProteinG: 150,
    targetCarbsG: 200,
    targetFatG: 60,
    isActive: true,
    mealsPerDay: 2,
    generatedAt: '2026-10-01T00:00:00Z',
    variants: variants.map((v) => ({ ...v, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 })),
  });
const simple = plan([{ dayType: 'all', meals: [bowl, stew] }]);
const sandwich = foodSchema.parse({
  id: id(700),
  name: 'Sandwich',
  source: 'manual',
  servingSizeG: 100,
  calories: 400,
  proteinG: 20,
  carbsG: 40,
  fatG: 10,
});

/** The server as the store sees it. Like `saveClientEstimate`, the first live answer is kept. */
function fixture(opts: { answers?: Record<string, unknown>[]; logged?: boolean } = {}) {
  const disk = new Map<string, string>();
  const answers = (opts.answers ?? []).slice();
  const logs = opts.logged
    ? [scaledLog(sandwich, { id: id(800), mealTypeId: lunch.id, foodItemId: sandwich.id, quantityMultiplier: 1, loggedAt: date + 'T02:00:00Z', date } as Parameters<typeof scaledLog>[1])]
    : [];
  const sent: { domain: string; payload: Record<string, unknown> }[] = [];
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: tz,
    get: async (path: string): Promise<unknown> => {
      if (path.endsWith('meal-types')) return [lunch, dinner];
      if (path.endsWith('food-items')) return [sandwich];
      if (path.endsWith('food-logs')) return logs.slice();
      if (path.endsWith('plan-meal-answers')) return { answers: answers.slice() };
      if (path.endsWith('targets')) return {};
      if (path.endsWith('meal-statuses')) return { date, statuses: [] };
      return [];
    },
    post: async (path: string, body: unknown) => {
      if (path.endsWith('meal-statuses')) return { success: true };
      for (const op of (body as { mutations: typeof sent }).mutations) {
        sent.push(op);
        if (op.domain === 'plan_meal_answers' && !answers.some((a) => a.planMealId === op.payload.planMealId)) {
          answers.push({ id: id(900 + answers.length), answeredAt: date + 'T06:00:00Z', ...op.payload });
        }
      }
      return { processed: sent.length, errors: [] };
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
    async store(kinds: readonly ('mealTypes' | 'foods' | 'logs' | 'answers')[] = ['mealTypes', 'foods', 'logs', 'answers']) {
      const store = new NutritionStore(storage, connection, uuid, () => {}, () => afternoon);
      await store.initialize();
      for (const kind of kinds) await store.refresh(kind, date);
      return store;
    },
  };
}
const run = (store: NutritionStore, p = simple, isTrainingDay?: boolean, now = afternoon) =>
  materialisePlanEstimates({ store, date, timezone: tz, plan: p, isTrainingDay, now });

test('an unlogged plan meal whose slot is over is estimated, reaches the server, and counts', async () => {
  const f = fixture();
  const store = await f.store();
  assert.equal(await run(store), 1);
  const view = store.view(date);
  // Lunch only: dinner's slot is still open.
  assert.deepEqual(
    estimatedMeals({ meals: simple.variants[0].meals as PlanMeal[], answers: view.answers, logs: view.logs, mealTypes: view.mealTypes }).map((e) => [e.meal.id, e.kcal]),
    [[bowl.id, 620]],
  );
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0, store.getSnapshot().error ?? '');
  assert.deepEqual(f.sent.map((op) => op.payload), [
    {
      planMealId: bowl.id,
      answer: 'estimated',
      estCalories: 620,
      estProteinG: 40,
      estCarbsG: 60,
      estFatG: 15,
      estBiasKcal: 0,
      estBasis: 'planA',
      logDate: date,
    },
  ]);
  // A second run finds it answered and writes nothing.
  assert.equal(await run(store), 0);
});

test('nothing is estimated before the slot is over, for a logged meal type, or for an answered meal', async () => {
  assert.equal(await run(await fixture().store(), simple, undefined, Date.parse(date + 'T04:00:00Z')), 0);
  assert.equal(await run(await fixture({ logged: true }).store()), 0);
  const declined = fixture({ answers: [{ id: id(950), planMealId: bowl.id, logDate: date, answer: 'no' }] });
  assert.equal(await run(await declined.store()), 0);
});

test('nothing is estimated until today’s logs and answers have been read, or for another day', async () => {
  assert.equal(await run(await fixture().store(['mealTypes', 'foods', 'logs'])), 0);
  assert.equal(await run(await fixture().store(['mealTypes', 'foods', 'answers'])), 0);
  const store = await fixture().store();
  assert.equal(await materialisePlanEstimates({ store, date: '2026-10-25', timezone: tz, plan: simple, isTrainingDay: undefined, now: afternoon }), 0);
});

test('a split plan is estimated only when the day type is known, against that day’s meals', async () => {
  const split = plan([
    { dayType: 'training', meals: [bowl] },
    { dayType: 'rest', meals: [{ ...bowl, id: id(502), targetCalories: 450 }] },
  ]);
  assert.equal(await run(await fixture().store(), split, undefined), 0);
  const store = await fixture().store();
  assert.equal(await run(store, split, false), 1);
  assert.equal(store.view(date).answers[0]?.planMealId, id(502));
});

test('the current app’s identical estimate already on the server still confirms the read-back', async () => {
  const f = fixture();
  const store = await f.store();
  // After Preview's read, the current app wrote the same estimate under its own id.
  f.answers.push({
    id: id(990),
    planMealId: bowl.id,
    logDate: date,
    answer: 'estimated',
    answeredAt: date + 'T05:30:00Z',
    estCalories: 620,
    estProteinG: 40,
    estCarbsG: 60,
    estFatG: 15,
    estBiasKcal: 0,
    estBasis: 'planA',
  });
  assert.equal(await run(store), 1);
  await store.sync();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.operations.length, 0, snapshot.error ?? '');
  assert.equal(f.answers.length, 1);
});
