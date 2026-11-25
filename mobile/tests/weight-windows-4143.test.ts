import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { WEIGHT_PACE_WINDOW_DAYS, weightSeriesOver } from '../src/features/health/data/body-view.ts';

// #4143 item 8: each weight rate names its window and its chart is drawn over that window.

const series = Array.from({ length: 30 }, (_, i) => {
  const day = String(30 - i).padStart(2, '0'); // 2026-11-30 back to 2026-11-01
  return { date: `2026-11-${day}`, weightKg: 80 + i / 10 };
});

test('the pace window is the 14 days the progress summary fits its rate over', () => {
  assert.equal(WEIGHT_PACE_WINDOW_DAYS, 14);
});

test('a window keeps only its own days, newest first', () => {
  const fortnight = weightSeriesOver(series, '2026-11-30', 14);
  assert.equal(fortnight.length, 14);
  assert.equal(fortnight[0].date, '2026-11-30');
  assert.equal(fortnight.at(-1)?.date, '2026-11-17');
  assert.equal(weightSeriesOver(series, '2026-11-30', 30).length, 30);
});

test('a day with no weight is not drawn', () => {
  const rows = [
    { date: '2026-11-30', weightKg: null },
    { date: '2026-11-29', weightKg: 80 },
  ];
  assert.deepEqual(weightSeriesOver(rows, '2026-11-30', 14).map((r) => r.date), ['2026-11-29']);
});

test('each card names its window and draws over it, not over the same seven days', () => {
  const src = readFileSync(
    new URL('../src/features/health/components/BodyWeightCards.tsx', import.meta.url),
    'utf8',
  );
  assert.match(src, /weightSeriesOver<WeighIn>\(weightSeries \?\? rows, today, WEIGHT_PACE_WINDOW_DAYS\)/);
  assert.match(src, /weightSeriesOver<WeighIn>\(weightSeries \?\? rows, today, WEIGHT_TREND_WINDOW_DAYS\)/);
  assert.match(src, /`Last \$\{WEIGHT_PACE_WINDOW_DAYS\} days`/);
  assert.match(src, /`Rate over \$\{WEIGHT_TREND_WINDOW_DAYS\} days`/);
  assert.doesNotMatch(src, /'Last 7 days'/);
});
