import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// #3893: the phone's own recap hands each set's effort source to the shared recap, so a pre-filled
// effort is left out of the effort climb there too (the shared rule is tested in session-recap.test.ts).
test('the phone recap passes each set\'s effort source to buildRecapFacts', () => {
  const src = readFileSync(new URL('../src/features/workouts/logging/local-recap.ts', import.meta.url), 'utf8');
  assert.match(src, /rpe: set\.rpe \?\? undefined,\s*rpeSource: set\.rpeSource \?\? undefined,/);
});
