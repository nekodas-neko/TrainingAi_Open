import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hrRecoveryProfileSpec } from '../src/features/health/data/models.ts';
import {
  rateDisplay,
  sourceMixLabel,
  trendSeries,
} from '../src/features/health/data/hr-recovery-view.ts';

test('the profile spec reads the route the current app reads', () => {
  assert.equal(hrRecoveryProfileSpec.path, '/api/health/hr-recovery-profile');
  const parsed = hrRecoveryProfileSpec.schema.parse({
    bands: [
      {
        label: '150+',
        n: 4,
        medianRateBpmMin: 22,
        recoveredPct: null,
        lowSignal: false,
        bySource: { set_rest: 4 },
      },
    ],
    totalEpisodes: 4,
    informativeShare: 0.4,
    trend: [{ label: '150+', points: [{ period: '2026-09', medianRateBpmMin: 20, n: 2 }] }],
  });
  assert.equal(parsed.bands[0].recoveredPct, null);
  assert.equal(parsed.trend[0].points.length, 1);
});

test('a band mixing sources names each, a single-source band says nothing', () => {
  assert.equal(sourceMixLabel({ set_rest: 12, run_cooldown: 3 }), '12 lifting, 3 workout');
  assert.equal(sourceMixLabel({ set_rest: 12 }), null);
  assert.equal(sourceMixLabel({ set_rest: 12, ambient: 0 }), null);
});

test('the rate arrow follows the current app: positive falls, negative rises', () => {
  assert.deepEqual(rateDisplay(21), { text: '↓21', direction: 'down' });
  assert.deepEqual(rateDisplay(-4), { text: '↑4', direction: 'up' });
  assert.deepEqual(rateDisplay(0), { text: '0', direction: null });
  assert.deepEqual(rateDisplay(null), { text: '—', direction: null });
});

test('only bands with two usable months get a trend line', () => {
  const point = (v: number | null) => ({ medianRateBpmMin: v });
  const lines = trendSeries([
    { label: '90–104', points: [point(10)] },
    { label: '105–119', points: [point(12), point(null)] },
    { label: '150+', points: [point(18), point(null), point(22)] },
  ]);
  assert.deepEqual(lines, [{ label: '150+', values: [18, 22] }]);
});
