import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  activityDeleteFailure,
  activityTypeBody,
  applyConfirmMessage,
  coverage,
  exerciseBody,
  exerciseConfirm,
  gifSource,
  reviewQueue,
  reviewedMap,
  toggleMuscle,
  type AdminExercise,
} from '../src/features/admin/data/admin-content.ts';
import { barShares, estCostUsd, fmtUsd } from '../src/features/admin/data/admin-monitoring.ts';

const ex = (over: Partial<AdminExercise>): AdminExercise => ({
  id: 'e', name: 'Squat', equipment: [], muscles: [], exerciseType: 'weighted',
  gifUrl: null, imageUrl: null, ...over,
});

test('coverage counts live exercises only, and a custom URL counts as covered', () => {
  const media = { squat: { gifUrl: 'x' } };
  const c = coverage(
    [ex({}), ex({ id: '2', name: 'Row', gifUrl: 'https://a/b.gif' }), ex({ id: '3', name: 'Old', mergedInto: 'Squat' }), ex({ id: '4', name: 'Curl' })],
    media,
  );
  assert.deepEqual(c, { live: 3, covered: 2, merged: 1 });
});

test('the review queue holds live exercises with a stored GIF and no verdict', () => {
  const media = { squat: { gifUrl: 'x' }, row: { gifUrl: 'y' }, old: { gifUrl: 'z' } };
  const reviewed = reviewedMap({
    reviewed: [
      { exerciseName: 'Row', gender: 'male', reviewStatus: 'ok' },
      { exerciseName: 'Bad', gender: 'male', reviewStatus: 'unreviewed' },
    ],
  });
  const queue = reviewQueue(
    [ex({ muscles: [{ muscle: 'Quads', role: 'main' }, { muscle: 'Core', role: 'secondary' }] }), ex({ id: '2', name: 'Row' }), ex({ id: '3', name: 'Old', mergedInto: 'Squat' })],
    media,
    reviewed,
  );
  assert.deepEqual(queue, [{ name: 'Squat', muscles: ['Quads'], equipment: [] }]);
});

test('GIF source: dataset mirror, AI, custom URL, none', () => {
  assert.equal(gifSource('A', null, { a: { gifUrl: 'x', modelUsed: 'dataset-mirror' } }), 'dataset');
  assert.equal(gifSource('A', null, { a: { gifUrl: 'x', modelUsed: 'gemini' } }), 'ai');
  assert.equal(gifSource('A', 'https://x', {}), 'custom');
  assert.equal(gifSource('A', null, {}), null);
});

test('muscle chips: name sets main, 2° sets secondary, the same tap again removes', () => {
  let m = toggleMuscle([], 'Chest', 'main');
  assert.deepEqual(m, [{ muscle: 'Chest', role: 'main' }]);
  m = toggleMuscle(m, 'Chest', 'secondary');
  assert.deepEqual(m, [{ muscle: 'Chest', role: 'secondary' }]);
  assert.deepEqual(toggleMuscle(m, 'Chest', 'secondary'), []);
});

test('request bodies send only named fields, with empty URLs as null', () => {
  const body = exerciseBody({ name: ' Squat ', equipment: ['barbell'], muscles: [], instructions: '', exerciseType: 'weighted', gifUrl: '', imageUrl: '' });
  assert.deepEqual(body, { name: 'Squat', equipment: ['barbell'], muscles: [], instructions: undefined, exerciseType: 'weighted', gifUrl: null, imageUrl: null });
  assert.deepEqual(activityTypeBody({ label: ' Rowing ', icon: 'Boat', isDistanceBased: true, sortOrder: 'x' }), { label: 'Rowing', icon: 'Boat', isDistanceBased: true, sortOrder: 0 });
});

test('delete failures read in the current app\'s words', () => {
  assert.equal(activityDeleteFailure({ status: 409 }), 'Activity type is in use');
  assert.equal(activityDeleteFailure({ status: 500 }), 'Delete failed');
});

test('confirm copy and the unit-fix warning match the current app word for word', () => {
  const manager = readFileSync(new URL('../../components/admin/exercise-manager.tsx', import.meta.url), 'utf8');
  for (const c of Object.values(exerciseConfirm)) {
    assert.ok(manager.includes(c.title), c.title);
    assert.ok(manager.includes(c.message), c.message);
  }
  const fix = readFileSync(new URL('../../components/admin/exercise-unit-fix.tsx', import.meta.url), 'utf8');
  const sample = applyConfirmMessage(2, ['A', 'B'], '2026-01-01');
  assert.ok(sample.includes('Sync your phone first (More → Data → Sync now).'));
  assert.ok(fix.includes('Sync your phone first (More → Data → Sync now).'));
  const types = readFileSync(new URL('../../components/admin/activity-type-manager.tsx', import.meta.url), 'utf8');
  assert.ok(types.includes('is removed from the activity type list for every user'));
});

test('AI usage: estimate, formatting, and bars never vanish for a quiet bucket', () => {
  assert.equal(estCostUsd(1_000_000, 1_000_000), 0.5);
  assert.equal(fmtUsd(0.004), '$0.0040');
  assert.equal(fmtUsd(1.234), '$1.23');
  assert.deepEqual(barShares([0, 1, 100]), [4, 4, 100]);
  assert.deepEqual(barShares([0, 0]), [0, 0]);
});
