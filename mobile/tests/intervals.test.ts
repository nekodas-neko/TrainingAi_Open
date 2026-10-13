import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coveredMinutes } from '../src/features/health/intervals.ts';
test('overlapping sources and duplicate sleep stages count time once', () => {
  assert.equal(coveredMinutes([{ start: 0, end: 120000 }, { start: 60000, end: 180000 }, { start: 0, end: 120000 }], 0, 240000), 3);
});
test('clips records to window and ignores invalid intervals', () => {
  assert.equal(coveredMinutes([{ start: -60000, end: 120000 }, { start: 180000, end: 300000 }, { start: NaN, end: 500000 }, { start: 100, end: 0 }], 0, 240000), 3);
});
test('empty data gives zero coverage, leaving availability to caller', () => {
  assert.equal(coveredMinutes([], 0, 240000), 0);
});
