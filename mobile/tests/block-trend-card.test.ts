import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK_TREND_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr';
import { BLOCK_TREND_COPY, blockTrendBasis } from '@trainingai/shared/ai-periodization/block-trend-copy';
import { blockTrendChart, blockTrendView } from '../src/features/health/data/block-trend-view.ts';
import { loadSpec, parseBlockTrend } from '../src/features/health/data/models.ts';

const base = {
  acwr: 1,
  acuteLoad: 1,
  chronicLoad: 1,
  monotony: 1,
  strain: 1,
  interpretation: 'optimal',
  baselineDaysRemaining: null,
};
const points = [0.7, 0.9, 1.0, 1.4].map((ratio, i) => ({ date: `2026-10-${String(1 + i * 7).padStart(2, '0')}`, ratio }));
const trend = (band: string, spanDays = 120) => ({ status: 'ok', ratio: 1, band, baselineWeeklyKg: 1000, spanDays, points });

test('a payload parses with and without blockTrend', () => {
  const without = loadSpec.schema.parse(base);
  assert.equal(without.blockTrend, undefined);
  const withIt = loadSpec.schema.parse({ ...base, blockTrend: trend('steady') });
  assert.equal(withIt.blockTrend?.band, 'steady');
  assert.equal(withIt.blockTrend?.points.length, 4);
});

test('an unknown band or status is not shown, a malformed point is dropped', () => {
  assert.equal(parseBlockTrend(trend('surging')), null);
  assert.equal(parseBlockTrend({ ...trend('steady'), status: 'maybe' }), null);
  assert.equal(parseBlockTrend('nope'), null);
  assert.deepEqual(blockTrendView(null), { kind: 'hidden' });
  const p = parseBlockTrend({ ...trend('steady'), points: [...points, { date: 3 }] });
  assert.equal(p?.points.length, 4);
});

test('each band shows its copy', () => {
  for (const band of ['steady', 'building', 'detraining'] as const) {
    const view = blockTrendView(parseBlockTrend(trend(band)));
    assert.equal(view.kind === 'ok' && view.copy, BLOCK_TREND_COPY[band]);
  }
  assert.equal(BLOCK_TREND_COPY.steady, 'Your last 4 weeks match your 3-month norm.');
  assert.equal(
    BLOCK_TREND_COPY.building,
    'Your last 4 weeks are heavier than your 3-month norm. You are in a build, so watch your recovery.',
  );
  assert.equal(
    BLOCK_TREND_COPY.detraining,
    'Your last 4 weeks are lighter than your 3-month norm. Fine after a deload, or ease back in if it was not planned.',
  );
});

test('not enough history shows for the status and for a payload without the field', () => {
  const noField = blockTrendView(undefined);
  const status = blockTrendView(
    parseBlockTrend({ status: 'not_enough_history', ratio: null, band: null, baselineWeeklyKg: null, spanDays: 12, points: [] }),
  );
  for (const view of [noField, status]) {
    assert.deepEqual(view, { kind: 'not_enough_history', message: 'Not enough history yet' });
  }
});

test('"Based on N weeks" shows under 13 weeks and hides at 13 or more', () => {
  assert.equal(blockTrendBasis(90), 'Based on 12 weeks');
  assert.equal(blockTrendBasis(35), 'Based on 5 weeks');
  assert.equal(blockTrendBasis(9), 'Based on 1 week');
  assert.equal(blockTrendBasis(91), null);
  assert.equal(blockTrendBasis(200), null);
  const short = blockTrendView(parseBlockTrend(trend('steady', 60)));
  const full = blockTrendView(parseBlockTrend(trend('steady', 91)));
  assert.equal(short.kind === 'ok' && short.basis, 'Based on 8 weeks');
  assert.equal(full.kind === 'ok' && full.basis, null);
});

test('the chart band and domain come from the shared thresholds', () => {
  const chart = blockTrendChart(points)!;
  assert.equal(chart.zone.from, BLOCK_TREND_THRESHOLDS.detrainingMax);
  assert.equal(chart.zone.to, BLOCK_TREND_THRESHOLDS.buildingMin);
  assert.ok(chart.domain[0] <= chart.zone.from && chart.domain[1] >= chart.zone.to);
  assert.ok(chart.domain[1] >= 1.4 && chart.domain[0] <= 0.7);
  assert.deepEqual(chart.axisLabels, ['3w ago', '', '', 'Now']);
  assert.equal(blockTrendChart(points.slice(0, 1)), null);
});
