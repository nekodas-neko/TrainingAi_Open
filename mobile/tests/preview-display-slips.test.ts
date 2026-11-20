import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prDetail } from '../src/features/health/data/week-view';
import { STRENGTH_BAR_LABELLED_MARKERS, STRENGTH_BAR_MARKERS } from '../src/features/health/progressPresentation';

test('a personal-record row does not repeat the exercise name', () => {
  assert.equal(
    prDetail({ exerciseName: 'Bench Press', description: 'Bench Press 96kg est. 1RM' }),
    '96kg est. 1RM',
  );
  assert.equal(prDetail({ exerciseName: 'Squat', description: '100kg' }), '100kg');
});

test('strength bar labels are fewer than the guides, so they cannot overlap', () => {
  assert.ok(STRENGTH_BAR_LABELLED_MARKERS.length < STRENGTH_BAR_MARKERS.length);
  assert.ok(STRENGTH_BAR_LABELLED_MARKERS.every((m) => STRENGTH_BAR_MARKERS.includes(m)));
});
