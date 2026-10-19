import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { budgetLine, balanceProvenance } from '../src/features/nutrition/data/budget-line.ts';
import { buildCatalog } from '../src/features/workouts/catalog.ts';
import {
  chartPadY,
  chartViewBoxHeight,
  coverTicks,
  dotMask,
  niceTicks,
  tickLabels,
} from '../src/shared/ui/chartScale.ts';

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('a budget held at its floor reads as the web does', () => {
  // Signs and zero terms are covered branch by branch in the shared budget-provenance test.
  const floored = balanceProvenance({
    restingBaseKcal: 1500,
    activeKcal: 0,
    targetNetKcal: -500,
    restingRateKcal: 1800,
    deficitKcal: 2500,
    stepCreditKcal: 0,
  });
  assert.ok(floored?.chain?.totalFloored, 'the fixture must hit the floor');
  assert.equal(
    budgetLine(floored!),
    `${floored!.total.toLocaleString()} minimum budget — never below your resting rate`,
  );
  assert.equal(balanceProvenance(null), null);
  assert.equal(balanceProvenance({ restingBaseKcal: 1500, activeKcal: null, targetNetKcal: 0 }), null);
});

test('Home and the Nutrition tab print the budget line from the same function', async () => {
  for (const file of [
    'features/home/components/HomeWidgets.tsx',
    'features/nutrition/components/NutritionEnergyCard.tsx',
    'features/health/components/BodyActivityCards.tsx',
  ]) {
    assert.match(await source(file), /budgetLine\(provenance, /, file);
  }
});

test('a chart fills the height it is given instead of being letterboxed to 320:90', () => {
  // A 300 px wide, 160 px tall plot: the viewBox is as tall as the box, so scale is width / 320.
  const height = chartViewBoxHeight(300, 160);
  assert.ok(Math.abs(height - (320 * 160) / 300) < 1e-9);
  assert.equal(Math.min(300 / 320, 160 / height), 300 / 320);
  // Before the first layout there is no width to fit: the old 320:90 box.
  assert.equal(chartViewBoxHeight(1, 160), 90);
  // The margin is 12 units, less on a very short sparkline.
  assert.equal(chartPadY(90), 12);
  assert.ok(chartPadY(40) < 12);
});

test('LineChart no longer hardcodes the 320:90 viewBox', async () => {
  const chart = await source('shared/ui/LineChart.tsx');
  assert.doesNotMatch(chart, /viewBox="0 0 320 90"/);
  assert.match(chart, /chartViewBoxHeight\(/);
});

test('the heart-rate charts ask for the web height and four y labels', async () => {
  assert.match(await source('features/health/components/HrDayCard.tsx'), /tickCount=\{4\}/);
  assert.match(await source('features/health/components/HeartDetails.tsx'), /tickCount: 4/);
  assert.match(await source('features/activities/components/CardioTrends.tsx'), /tickCount=\{4\}/);
});

test('four ticks of a heart-rate day, and an axis that reaches past the tallest bar', () => {
  assert.deepEqual(niceTicks(55, 95, 4), [60, 70, 80, 90]);
  assert.deepEqual(niceTicks(55, 95), [60, 80], 'the default stays at about three');
  // 5,200 weekly zone minutes: ticks 0 / 2,000 / 4,000 would leave the bar above its top label.
  const ticks = coverTicks(niceTicks(0, 5200, 4), 5200);
  assert.deepEqual(ticks, [0, 2000, 4000, 6000]);
  assert.deepEqual(tickLabels(ticks, 'full'), ['0', '2,000', '4,000', '6,000']);
  assert.deepEqual(tickLabels(ticks), ['0', '2k', '4k', '6k']);
});

test('the 24-hour chart draws no dots, as the web does; the others keep their rule', () => {
  assert.deepEqual(dotMask([1, null, 2, 3], 'none'), [false, false, false, false]);
  assert.deepEqual(dotMask([1, 2, 3], 'all'), [true, true, true]);
});

test('the Home rest strip needs the rest-day fields the catalog now carries', () => {
  const parsed = buildCatalog(
    { program: null, exercises: [], sessions: [] },
    {
      session: null,
      isRestDay: true,
      reason: 'Rest',
      consecutiveRestDays: 2,
      streakWarning: true,
      streakBroken: false,
    },
    [],
    { origin: 'https://x.test', userId: 'u1' },
    1,
  );
  assert.equal(parsed.recommendation.consecutiveRestDays, 2);
  assert.equal(parsed.recommendation.streakWarning, true);
  assert.equal(parsed.recommendation.streakBroken, false);
});

test('only a bar chart that passes tickCount has its axis rounded up', async () => {
  for (const file of ['shared/ui/BarChart.tsx', 'shared/ui/StackedBarChart.tsx']) {
    const text = await source(file);
    assert.match(text, /tickCount === undefined\s*\?\s*niceTicks\(0, wanted\)/, file);
  }
});
