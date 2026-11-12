import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rescaleRemaining } from '@trainingai/shared/nutrition/plan-rescale';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// Preview's plan meals as they arrive on the wire: `id` may be missing.
const meal = (position: number, kcal: number, id?: string) => ({
  id,
  position,
  targetCalories: kcal,
  targetProteinG: (kcal * 0.3) / 4,
  targetCarbsG: (kcal * 0.4) / 4,
  targetFatG: (kcal * 0.3) / 9,
});
const target = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 };

test('Preview re-balances the remaining meals with the shared rule (#3730)', () => {
  const r = rescaleRemaining({
    meals: [meal(1, 600, 'm1'), meal(2, 700, 'm2'), meal(3, 700)],
    target,
    eaten: { ...target, calories: 900 },
    loggedPositions: new Set([1]),
    declinedMealIds: new Set(),
    isToday: true,
  });
  assert.equal(r?.byPosition.get(2)?.calories, 550);
  assert.equal(r?.byPosition.get(3)?.calories, 550);
  assert.equal(r?.byPosition.has(1), false);
  assert.equal(r?.note, null);
});

test('a meal with no id is never treated as declined (#3730)', () => {
  const r = rescaleRemaining({
    meals: [meal(1, 600, 'm1'), meal(2, 700)],
    target,
    eaten: { ...target, calories: 600 },
    loggedPositions: new Set([1]),
    declinedMealIds: new Set(['m1']),
    isToday: true,
  });
  assert.equal(r?.byPosition.get(2)?.calories, 1400);
});

test('the plan card applies it on today only and falls back to the planned numbers (#3730)', () => {
  const src = read('features/meal-plans/components/PlanMeals.tsx');
  assert.match(src, /const rescale = variant\s*\?\s*rescaleRemaining\(\{/);
  assert.match(src, /isToday: date === n\.today/);
  assert.match(src, /eaten: n\.view\.logs\.length \? totals\(n\.view\.logs\) : undefined/);
  assert.match(src, /rescale\?\.byPosition\.get\(m\.position\)/);
  assert.match(src, /rescale\?\.note/);
  assert.match(src, /\(planned \{m\.targetCalories\.toLocaleString\(\)\}\)/);
});
