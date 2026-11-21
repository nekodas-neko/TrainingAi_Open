// #3964: the AI builder's review step takes an optional starting 1RM per main lift and sends the
// entries POST /api/exercise-estimates expects (kg, positive, at most 1000).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateRequestBody, startingOneRmExercises } from '../src/features/programs/builder-model.ts';
import type { ProgramDraft } from '../src/features/programs/editor-model.ts';

const ex = (exerciseName: string, exerciseRole: string) => ({ exerciseName, exerciseRole });
const review = {
  name: 'Plan',
  sessions: [
    { name: 'A', exercises: [ex('Squat', 'primary'), ex('Leg Curl', 'accessory'), ex('Row', 'secondary')] },
    { name: 'B', exercises: [ex('Squat', 'primary'), ex('Bench Press', 'primary')] },
  ],
} as unknown as ProgramDraft;

test('lists primary and secondary lifts once each', () => {
  assert.deepEqual(startingOneRmExercises(review), ['Squat', 'Row', 'Bench Press']);
});

test('builds the route body from typed values and drops blanks and bad numbers', () => {
  const names = ['Squat', 'Row', 'Bench Press', 'Deadlift', 'Press'];
  const body = estimateRequestBody(
    { Squat: '140', Row: ' ', 'Bench Press': '102,5', Deadlift: '0', Press: 'abc' },
    names,
  );
  assert.deepEqual(body, {
    entries: [
      { exerciseName: 'Squat', estimated1rm: 140 },
      { exerciseName: 'Bench Press', estimated1rm: 102.5 },
    ],
  });
});

test('sends nothing when every field is blank, and rejects what the route would', () => {
  assert.equal(estimateRequestBody({}, ['Squat']), null);
  assert.equal(estimateRequestBody({ Squat: '-5' }, ['Squat']), null);
  assert.equal(estimateRequestBody({ Squat: '1001' }, ['Squat']), null);
  assert.deepEqual(estimateRequestBody({ Squat: '1000' }, ['Squat']), {
    entries: [{ exerciseName: 'Squat', estimated1rm: 1000 }],
  });
});
