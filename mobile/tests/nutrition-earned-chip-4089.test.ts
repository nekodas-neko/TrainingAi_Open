import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetProvenance, computeCalorieBalance } from '@trainingai/shared/nutrition/calorie-balance';
import { earnedChipText } from '../src/features/nutrition/data/budget-line.ts';
import { nutritionEnergyModel } from '../src/features/nutrition/data/energy-model.ts';

// #4089. The balance is the shared function's real output with the two inputs the service adds
// beside it, the shape /api/nutrition/energy-balance sends as `balance`.
const day = (activeKcal: number) => ({
  ...computeCalorieBalance({
    restingBaseKcal: 1700,
    activeKcal,
    intakeKcal: 1200,
    goalDeltaKcal: -400,
    restingRateKcal: 1750,
    deficitKcal: 400,
    stepCreditKcal: 100,
    ownTargetKcal: null,
  }),
  restingBaseKcal: 1700,
  activeKcal,
});
const totals = { calories: 1200, proteinG: 100, carbsG: 100, fatG: 40 };
const left = (b: ReturnType<typeof day>) =>
  nutritionEnergyModel({
    totals,
    recordedIntake: null,
    budgetKcal: b.budgetKcal,
    targets: {},
    scaledTargets: null,
  }).remaining;
const earnedOf = (b: ReturnType<typeof day>) => budgetProvenance(b as never).earned;

test('earned calories show as "+N earned", the shared budget split\'s own figure', () => {
  const b = day(551);
  assert.ok(earnedOf(b) > 0);
  assert.equal(earnedChipText(b), `+${earnedOf(b)} earned`);
});
test('the figure is formatted with a thousands separator', () => {
  const b = day(2500);
  assert.ok(earnedOf(b) >= 1000);
  assert.match(earnedChipText(b)!, /^\+\d,\d{3} earned$/);
});
test('no chip when nothing was earned or the balance is unknown', () => {
  assert.equal(earnedOf(day(0)), 0);
  assert.equal(earnedChipText(day(0)), null);
  assert.equal(earnedChipText(null), null);
  assert.equal(earnedChipText(undefined), null);
  assert.equal(earnedChipText({ restingBaseKcal: 1700, activeKcal: null, targetNetKcal: -400 }), null);
  assert.equal(earnedChipText({ restingBaseKcal: 1700, activeKcal: 300 }), null);
});
test('the chip explains "kcal left" and does not change it: the budget already carries the earned calories', () => {
  const still = day(0);
  const moving = day(551);
  // The wire budget is the shared split's total, so "left" (budget minus eaten) includes the earned part.
  assert.equal(moving.budgetKcal, budgetProvenance(moving as never).total);
  assert.equal(left(moving), moving.budgetKcal - 1200);
  assert.equal(left(moving)! - left(still)!, earnedOf(moving));
});
