import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #4143 item 5: a day's workout card has a text "Delete workout" and a bin per lift, never two bins.

test('the workout-level delete is a text button in the compact day card too', () => {
  const src = readFileSync(
    new URL('../src/features/workouts/screens/WorkoutHistoryScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(src, /label="Delete workout"/, 'no icon button is named Delete workout');
  assert.match(src, /readOnly \? null : \(\s+<AppButton\s+title="Delete workout"/);
  assert.equal((src.match(/title="Delete workout"/g) ?? []).length, 1);
  assert.match(src, /label=\{'Delete ' \+ entry\.name\}/, 'each lift keeps its own bin, named for it');
});
