// #3964: Preview offers the web card's "Use prior data" on a session whose baseline is not done.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPriorDataBody, periodizationRow } from '../src/features/health/data/training-view.ts';

test('only an unfinished baseline offers the action', () => {
  const row = (state: Parameters<typeof periodizationRow>[0]['state']) =>
    periodizationRow({ state, lastTrainedDaysAgo: 2 }).needsBaseline;
  assert.equal(row({ phase: 'baseline', baselineComplete: false }), true);
  assert.equal(row({ phase: 'baseline', baselineComplete: null }), true);
  assert.equal(row({ phase: 'baseline', baselineComplete: true }), false);
  assert.equal(row({ phase: 'accumulation', baselineComplete: false }), false);
  assert.equal(row(null), false);
  assert.equal(row(undefined), false);
});

test('the request body is the strict { sessionId } the route parses', () => {
  assert.deepEqual(applyPriorDataBody('3f0c1d52-8a43-4c1e-9d7a-2b6f5e1a9c00'), {
    sessionId: '3f0c1d52-8a43-4c1e-9d7a-2b6f5e1a9c00',
  });
});
