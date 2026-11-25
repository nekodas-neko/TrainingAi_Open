import assert from 'node:assert/strict';
import test from 'node:test';

import { dayScoreRows, dayScoreTile } from '../src/features/health/data/day-scores.ts';

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

test('the day screen tiles: an empty day says "No score" for scores and "No reading" for resting heart rate', () => {
  assert.deepEqual(dayScoreRows(null), [
    { label: 'Readiness', text: 'No score', muted: true },
    { label: 'HR', text: 'No reading', muted: true },
    { label: 'Sleep', text: 'No score', muted: true },
    { label: 'Move', text: 'No score', muted: true },
  ]);
  assert.deepEqual(
    dayScoreRows({ scores: { readiness: 82, sleep: 0 }, bodyMeta: { restingHeartRate: 51 } }),
    [
      { label: 'Readiness', text: '82', muted: false },
      { label: 'HR', text: '51', muted: false },
      { label: 'Sleep', text: '0', muted: false },
      { label: 'Move', text: 'No score', muted: true },
    ],
  );
});
