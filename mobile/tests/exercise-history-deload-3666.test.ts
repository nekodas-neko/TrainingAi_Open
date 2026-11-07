import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oneRmTrendEntries } from '../src/features/workouts/data/exercise-history.ts';

test('a deload log (a stored 1RM of 0) is left off the 1RM trend (#3666)', () => {
  const entries = [
    { date: '2026/11/04 12:00', estimated1rm: 102.5 },
    { date: '2026/11/01 12:00', estimated1rm: 0 },
    { date: '2026/10/29 12:00', estimated1rm: null },
    { date: '2026/10/26 12:00', estimated1rm: 100 },
  ];
  assert.deepEqual(
    oneRmTrendEntries(entries).map((entry) => entry.estimated1rm),
    [100, 102.5],
    'oldest first, no zero and no gap',
  );
});
