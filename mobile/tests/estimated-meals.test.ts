import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assumedLine,
  estimateActionFrom,
  estimateKcal,
  estimateReminders,
  estimatedMeals,
  planPickerMeals,
  reminderTarget,
  reminderText,
  type PlanMeal,
} from '../src/features/meal-plans/data/estimated-meals.ts';
import { planAlerts } from '../src/features/platform/data/alert-plan.ts';
import { alertSignature } from '../src/features/platform/data/models.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';

const LUNCH_TYPE = 'type-lunch';
const DINNER_TYPE = 'type-dinner';
const types = [
  { id: LUNCH_TYPE, name: 'Lunch', timeStartHour: 11, timeEndHour: 15, remindersEnabled: true },
  { id: DINNER_TYPE, name: 'Dinner', timeStartHour: 17, timeEndHour: 21, remindersEnabled: false },
].map((t) => ({ emoji: '', sortOrder: 0, required: false, userId: 'u', createdAt: '', ...t }));
const ingredient = {
  name: 'Rice',
  weightG: 200,
  caloriesPer100g: 130,
  proteinPer100g: 2,
  carbsPer100g: 28,
  fatPer100g: 0.3,
};
const meal = (id: string, over: Partial<PlanMeal> = {}) =>
  ({
    id,
    position: 0,
    name: 'Chicken rice bowl',
    mealTypeId: LUNCH_TYPE,
    suggestedTime: '12:30',
    targetCalories: 620,
    targetProteinG: 40,
    targetCarbsG: 70,
    targetFatG: 15,
    ingredients: [ingredient],
    ...over,
  }) as PlanMeal;
const estimate = (planMealId: string, kcal = 620) => ({
  planMealId,
  logDate: '2026-10-26',
  answer: 'estimated',
  estCalories: kcal,
});

test('an estimated meal is listed with its assumed kcal until something of its type is logged', () => {
  const lunch = meal('m1');
  const input = { meals: [lunch], answers: [estimate('m1', 619.6)], logs: [], mealTypes: types };
  const [row] = estimatedMeals(input);
  assert.equal(row.kcal, 620);
  assert.equal(row.mealTypeName, 'Lunch');
  assert.equal(assumedLine(row.meal.name, row.kcal), 'Assumed: Chicken rice bowl, 1 serving · 620 kcal');
  // Anything logged under Lunch supersedes the assumption, as the ring already does.
  assert.deepEqual(estimatedMeals({ ...input, logs: [{ mealTypeId: LUNCH_TYPE }] }), []);
  // Food under another meal group does not.
  assert.equal(estimatedMeals({ ...input, logs: [{ mealTypeId: DINNER_TYPE }] }).length, 1);
});

test('only a live estimate with calories is an estimated meal', () => {
  const lunch = meal('m1');
  const base = { meals: [lunch], logs: [], mealTypes: types };
  assert.deepEqual(estimatedMeals({ ...base, answers: [] }), []);
  assert.deepEqual(estimatedMeals({ ...base, answers: [{ planMealId: 'm1', answer: 'no' }] }), []);
  assert.deepEqual(estimatedMeals({ ...base, answers: [{ planMealId: 'm1', answer: 'estimated' }] }), []);
  assert.deepEqual(estimatedMeals({ ...base, answers: [estimate('m1', 0)] }), []);
  assert.deepEqual(estimatedMeals({ ...base, answers: [estimate('other')] }), []);
  assert.equal(estimateKcal(undefined), null);
  // A meal the plan cannot place in a meal group is not food the ring counts, so it has no row.
  const unplaced = meal('m2', { mealTypeId: null, suggestedTime: null });
  assert.deepEqual(estimatedMeals({ ...base, meals: [unplaced], answers: [estimate('m2')], mealTypes: [] }), []);
});

test('the plan picker offers other unrecorded meals that can be logged', () => {
  const a = meal('a');
  const b = meal('b', { name: 'Lentil soup' });
  const noIngredients = meal('c', { ingredients: [] });
  const done = meal('d', { name: 'Already eaten' });
  const picked = planPickerMeals([a, b, noIngredients, done], 'a', (m) => m.id === 'd');
  assert.deepEqual(picked.map((m) => m.id), ['b']);
});

test('reminder actions map to the answers, and anything else opens the sheet', () => {
  assert.equal(estimateActionFrom('meal-ate'), 'ate');
  assert.equal(estimateActionFrom('meal-else'), 'else');
  assert.equal(estimateActionFrom('meal-skipped'), 'skipped');
  assert.equal(estimateActionFrom('expo.modules.notifications.actions.DEFAULT'), 'open');
  assert.equal(estimateActionFrom(undefined), 'open');
  assert.equal(estimateActionFrom('__proto__'), 'open');
});

const reminderInput = {
  date: '2026-10-26',
  tz: 'Australia/Brisbane',
  meals: [meal('m1')],
  answers: [],
  logs: [],
  mealTypes: types,
};

test('a reminder is due when the slot is over, in the user\'s timezone, with the approved words', () => {
  const [reminder] = estimateReminders(reminderInput);
  // Lunch ends at 15:00 and the meal is suggested at 12:30, so the later of 15:00 and 13:30.
  assert.equal(new Date(reminder.at).toISOString(), '2026-10-26T05:00:00.000Z');
  assert.deepEqual(reminderText(reminder), {
    title: 'Lunch: Chicken rice bowl, 1 serving',
    body: 'Counted as about 620 kcal until you answer.',
  });
});

test('no reminder for a meal group with reminders off, or a meal already answered', () => {
  const dinner = meal('m2', { mealTypeId: DINNER_TYPE, suggestedTime: '19:00' });
  assert.deepEqual(estimateReminders({ ...reminderInput, meals: [dinner] }), []);
  assert.deepEqual(estimateReminders({ ...reminderInput, logs: [{ mealTypeId: LUNCH_TYPE }] }), []);
  assert.deepEqual(
    estimateReminders({ ...reminderInput, answers: [{ planMealId: 'm1', answer: 'no' }] }),
    [],
  );
  assert.deepEqual(estimateReminders({ ...reminderInput, meals: [meal('m1', { ingredients: [] })] }), []);
  // The estimate itself being there does not end the question: the owner has not answered.
  assert.equal(estimateReminders({ ...reminderInput, answers: [estimate('m1')] }).length, 1);
});

test('the reminder text does not move when the estimate appears beside it', () => {
  const before = estimateReminders(reminderInput)[0];
  const after = estimateReminders({ ...reminderInput, answers: [estimate('m1', 650)] })[0];
  assert.deepEqual(after, before);
});

test('planAlerts schedules a meal reminder that carries the answer actions\' data', () => {
  const settings = platformSchema.parse({ scope: 'u1' });
  const [reminder] = estimateReminders(reminderInput);
  const alerts = planAlerts(settings, [], null, Date.parse('2026-10-26T00:00:00Z'), [reminder]);
  assert.equal(alerts.length, 1);
  const [alert] = alerts;
  assert.equal(alert.id, 'u1:meal-estimate:2026-10-26:m1');
  assert.equal(alert.target, 'nutrition');
  assert.deepEqual(alert.mealEstimate, { planMealId: 'm1', date: '2026-10-26' });
  assert.deepEqual(alert.trigger, { at: reminder.at });
  // Unchanged inputs give an unchanged signature, so the scheduler leaves it alone.
  const again = planAlerts(settings, [], null, Date.parse('2026-10-26T01:00:00Z'), [reminder]);
  assert.equal(alertSignature(again[0]), alertSignature(alert));
  assert.deepEqual(planAlerts(settings, [], null, 0), []);
});

test('a reminder for a meal the plan has not loaded yet has no target, so it can be answered later', () => {
  const lunch = meal('m1');
  const otherVariant = [meal('m9')];
  // Cold start on a split plan: the variant loaded so far does not hold the reminded meal.
  assert.equal(reminderTarget('m1', otherVariant, types as never), null);
  assert.equal(reminderTarget('m1', [], types as never), null);
  const target = reminderTarget('m1', [...otherVariant, lunch], types as never);
  assert.equal(target?.meal.id, 'm1');
  assert.equal(target?.mealTypeId, LUNCH_TYPE);
});
