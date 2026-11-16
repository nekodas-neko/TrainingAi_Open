import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionPreparationSchema } from '../src/features/workouts/data/models.ts';

// #3815: since zod 4.4 a bare z.unknown() key is required; these two stay optional as they were.
test('workout data without program or session still parses', () => {
  const r = sessionPreparationSchema.safeParse({ exercises: [], aiPrescriptionPending: false });
  assert.equal(r.success, true);
  assert.equal(r.data?.program, undefined);
  assert.equal(r.data?.session, undefined);
});
