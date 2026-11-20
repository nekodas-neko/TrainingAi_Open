import assert from 'node:assert/strict';
import test from 'node:test';
import { progressionSetLabel } from '../src/features/programs/editor-model.ts';

// #3895: under the AI plan the exercise's progression set is only read when the plan is off.
test('the progression set picker says when it is used under the AI plan', () => {
  assert.equal(progressionSetLabel('ai_dynamic'), 'Used when the AI plan is off');
  assert.equal(progressionSetLabel('automatic'), 'Progression set');
  assert.equal(progressionSetLabel('manual'), 'Progression set');
  assert.equal(progressionSetLabel(undefined), 'Progression set');
});
