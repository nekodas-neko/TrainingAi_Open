// #3896 step 4: a stored prescription's exercise may now carry an optional `liftPreference` (what a
// lift's stored preference changed on the plan). An app build that does not know the field must still
// parse the plan exactly as before; one that does can read it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { periodizationSchema } from '../src/features/workouts/data/models.ts';

const plan = (exercise: Record<string, unknown>) => ({
  state: {
    phase: 'accumulation',
    prescriptionStatus: 'pending',
    prescription: {
      phase: 'accumulation',
      phaseAction: 'stay',
      reasoning: 'r',
      deload: false,
      estimatedSessionDurationMin: 40,
      exercises: [exercise],
    },
  },
});
const row = { sessionExerciseId: 'se-1', name: 'Lift', sets: 3, reps: 12, pct: 62.5, restSec: 90 };

test('a plan without the field parses as before', () => {
  const parsed = periodizationSchema.parse(plan(row));
  assert.deepEqual(parsed.state?.prescription?.exercises[0], row);
});

test('a plan with the field parses, and the numbers are unchanged', () => {
  const liftPreference = { repRange: { min: 12, max: 15 }, loadStep: 'lighter', oneShotSetAt: '2026-11-20T00:00:00.000Z' };
  const parsed = periodizationSchema.parse(plan({ ...row, liftPreference }));
  const ex = parsed.state?.prescription?.exercises[0] as Record<string, unknown>;
  assert.equal(ex.reps, 12);
  assert.equal(ex.pct, 62.5);
  assert.deepEqual(ex.liftPreference, liftPreference);
});
