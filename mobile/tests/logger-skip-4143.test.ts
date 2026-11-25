import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { skipExerciseMessage } from '../src/features/workouts/logging/logger-copy.ts';

// #4143 item 4: the Skip button has a visible label and its own confirmation naming the exercise.

const screen = () =>
  readFileSync(
    new URL('../src/features/workouts/screens/GuidedWorkoutScreen.tsx', import.meta.url),
    'utf8',
  );

test('the skip confirmation names the exercise and what happens to its logged sets', () => {
  assert.equal(
    skipExerciseMessage('Back Squat', false),
    'Skip Back Squat? Sets you have already logged on it stay saved. You move on to the next exercise.',
  );
  assert.match(skipExerciseMessage('Back Squat', true), /You go back to the session\.$/);
});

test('the button beside Start Set carries a visible "Skip" label, not an empty title', () => {
  const src = screen();
  assert.match(src, /title="Skip"\s+icon="skip"/);
  assert.doesNotMatch(src, /title=""\s+icon="skip"/);
});

test('the skip confirmation no longer reuses the "recorded progress" line', () => {
  assert.match(screen(), /confirmation === 'skip'\s+\? skipExerciseMessage\(exercise\.name/);
});
