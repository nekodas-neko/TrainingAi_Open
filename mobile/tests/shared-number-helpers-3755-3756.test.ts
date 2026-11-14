// #3755 and #3756: figures Preview used to work out by hand now come from the shared helpers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { formatDistanceKm, formatMinutes } from '@trainingai/shared/format/units';
import { formatPace, formatPaceValue } from '@trainingai/shared/health/vdot';
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit';
import { computeSetAggregates } from '@trainingai/shared/workout/set-aggregates';
import { formatDuration } from '../src/shared/hooks/format-duration.ts';
import { exerciseVolume } from '../src/features/workouts/logging/summary.ts';
import { foodSchema, totals } from '../src/features/nutrition/data/models.ts';
import { recipeTotals } from '../src/features/nutrition/data/recipes.ts';
import { loggedAverage, weekWithToday } from '../src/features/nutrition/data/weekly-today.ts';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('a pace of 359.6 seconds reads 6:00, never 5:60', () => {
  assert.equal(formatPaceValue(359.6), '6:00');
  assert.equal(formatPace(359.6), '6:00/km');
});

test('no activity or running screen splits a pace or a clock by hand', () => {
  for (const path of [
    'features/health/components/ActivityDetails.tsx',
    'features/activities/screens/RunningScreen.tsx',
    'features/activities/screens/GuidedActivityScreen.tsx',
    'features/activities/screens/ActivityScreen.tsx',
  ]) {
    assert.doesNotMatch(source(path), /padStart\(2, '0'\)/, path);
  }
});

test('a finished walk shows whole minutes, as history does', () => {
  assert.equal(formatMinutes(2544 / 60, { unit: false }), '42');
  assert.doesNotMatch(
    source('features/activities/screens/GuidedActivityScreen.tsx'),
    /seconds \/ 60\)\.toFixed/,
  );
});

test('the running clock never shows a fraction and rolls into hours', () => {
  assert.equal(formatDuration(65.3), '1:05');
  assert.equal(formatDuration(-4), '0:00');
  assert.equal(formatDuration(3903), '1:05:03');
});

test('a distance has 2 decimals under 10 km and 1 from 10 km', () => {
  assert.equal(formatDistanceKm(5.234), '5.23 km');
  assert.equal(formatDistanceKm(9.996), '10.0 km');
  assert.equal(formatDistanceKm(12.34, { unit: false }), '12.3');
});

test('a workout volume is the figure the server stores', () => {
  const weights = [60, 62.5, 62.5];
  const reps = [8, 8, 7];
  assert.equal(exerciseVolume(weights, reps), computeSetAggregates(weights, reps).volume);
  assert.equal(exerciseVolume(weights, reps), 1417.5);
  // An assisted set subtracts, as the stored figure does; the finish screen used to count it as 0.
  assert.equal(exerciseVolume([-20, -20], [5, 5]), computeSetAggregates([-20, -20], [5, 5]).volume);
  assert.equal(exerciseVolume([], []), 0);
});

test('calorie and macro sums go through the shared sum, rounding the total only', () => {
  const rows = [
    { calories: 100.4, proteinG: 1.04, carbsG: 10, fatG: 0.5 },
    { calories: 100.4, proteinG: 1.04, carbsG: 10, fatG: 0.5 },
  ];
  assert.deepEqual(totals(rows), sumMacroTotals(rows));
  const food = foodSchema.parse({
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Oats',
    source: 'manual',
    servingSizeG: 100,
    calories: 100.4,
    proteinG: 1.04,
    carbsG: 10,
    fatG: 0.5,
  });
  const items = [1, 1, 1].map(() => ({ foodItemId: food.id, quantityMultiplier: 1, food }));
  // Three ingredients of 100.4 kcal are 301 kcal; rounding each first gave 300.
  assert.deepEqual(recipeTotals(items as Parameters<typeof recipeTotals>[0], []), {
    calories: 301,
    proteinG: 3.1,
    carbsG: 30,
    fatG: 1.5,
  });
});

test("today's bar keeps the server's figure when the phone has recorded nothing", () => {
  const week = [
    { date: '2026-10-10', calories: 1800, proteinG: 120, carbsG: 200, fatG: 60, logged: true },
    { date: '2026-10-11', calories: 900, proteinG: 50, carbsG: 100, fatG: 30, logged: true },
  ];
  const same = weekWithToday(week, {
    date: '2026-10-11',
    intake: 900,
    totals: null,
    recorded: false,
  });
  assert.deepEqual(same, week);
  assert.deepEqual(loggedAverage(same), { days: 2, calories: 1350 });
  // Earlier days never change, and a day with every food removed on the phone is unlogged.
  const cleared = weekWithToday(week, {
    date: '2026-10-11',
    intake: 0,
    totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    recorded: true,
  });
  assert.deepEqual(cleared[0], week[0]);
  assert.deepEqual(loggedAverage(cleared), { days: 1, calories: 1800 });
});
