import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #4143 item 3: the logger's title is the session name in every stage; "Warm up" is the subtitle.

test('the warm-up title is the session name and "Warm up" sits in the subtitle', () => {
  const src = readFileSync(
    new URL('../src/features/workouts/screens/GuidedWorkoutScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /— Warm Up/);
  assert.match(src, /title=\{flow\.stage === 'summary' \? exercise\.name : workout\.sessionName\}/);
  assert.match(src, /flow\.stage === 'warmup'\s+\? 'Warm up'/);
});
