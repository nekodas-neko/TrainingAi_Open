import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBarMetric } from '@trainingai/shared/health/strength-progress';
import {
  goalCountText,
  lastTrainedSession,
  strengthDelta,
  strengthFillPct,
} from '../src/features/health/progressPresentation';

const base = {
  estimated1rm: 100,
  previousEstimated1rm: 90,
  personalRecord1rm: 100,
  weight: 80,
  exerciseType: 'weighted' as const,
  lastReps: null,
  maxReps: null,
};

test('a loaded exercise reads its delta in kg, green when up and red when down', () => {
  const up = strengthDelta(computeBarMetric(base, 'latest')!);
  assert.deepEqual(up, { text: '+10 kg', color: '#22c55e' });
  const down = strengthDelta(computeBarMetric({ ...base, previousEstimated1rm: 110 }, 'latest')!);
  assert.equal(down?.text, '-10 kg');
  assert.equal(down?.color, '#f87171');
});

test('a rep exercise reads its delta in reps, never RM', () => {
  const metric = { pct: 80, label: '10 reps', color: '#bf5fff', deltaUnit: 'RM' as const };
  assert.deepEqual(strengthDelta({ ...metric, trend: 'up', delta: 3 }), {
    text: '+3 reps',
    color: '#22c55e',
  });
  assert.equal(strengthDelta({ ...metric, trend: 'down', delta: 1 })?.text, '-1 rep');
});

test('no delta is shown when nothing changed or there is no previous reading', () => {
  assert.equal(strengthDelta(computeBarMetric({ ...base, previousEstimated1rm: 100 }, 'latest')!), null);
  assert.equal(strengthDelta(computeBarMetric({ ...base, previousEstimated1rm: null }, 'latest')!), null);
});

test('the last trained session is the one with the newest dated reading', () => {
  assert.equal(
    lastTrainedSession([
      { sessionName: 'Pull', date: '2026-10-10', estimated1rm: 80 },
      { sessionName: 'Push', date: '2026-10-14', estimated1rm: 90 },
      { sessionName: 'Legs', date: '2026-10-16', estimated1rm: null },
      { sessionName: 'Upper', date: null, estimated1rm: 70 },
    ]),
    'Push',
  );
  assert.equal(lastTrainedSession([]), null);
});

test('a low strength fill keeps a visible sliver', () => {
  assert.equal(strengthFillPct(1), 4);
  assert.equal(strengthFillPct(72), 72);
});

test('goal counts group digits, count workouts, and tick when met', () => {
  assert.equal(goalCountText('Steps', 3200, 8000, false), '3,200 / 8,000');
  assert.equal(goalCountText('Steps', 8000, 8000, false), '8,000 / 8,000 ✓');
  assert.equal(goalCountText('Workouts', 1, 1, false), '1 / 1 workout ✓');
  assert.equal(goalCountText('Workouts', 2, 4, true), 'This week: 2 / 4 workouts');
});
