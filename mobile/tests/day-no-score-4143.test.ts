import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { dayScoreTile } from '../src/features/health/data/day-scores.ts';

// #4143 item 11: an unscored day says "No score" in muted text, not a coloured dash.

test('a missing score reads "No score", muted', () => {
  assert.deepEqual(dayScoreTile(undefined, 'No score'), { text: 'No score', muted: true });
  assert.deepEqual(dayScoreTile(null, 'No score'), { text: 'No score', muted: true });
  assert.deepEqual(dayScoreTile(Number.NaN, 'No score'), { text: 'No score', muted: true });
});

test('a score of zero is a score, and a real score keeps its figure and colour', () => {
  assert.deepEqual(dayScoreTile(0, 'No score'), { text: '0', muted: false });
  assert.deepEqual(dayScoreTile(82, 'No score'), { text: '82', muted: false });
});

test('resting heart rate, a reading and not a score, says "No reading"', () => {
  const src = readFileSync(
    new URL('../src/features/health/screens/HealthDayScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(src, /label: 'HR',[\s\S]*?missing: 'No reading'/);
  assert.equal((src.match(/missing: 'No score'/g) ?? []).length, 3);
});
