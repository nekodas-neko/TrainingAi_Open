import assert from 'node:assert/strict';
import test from 'node:test';

import { CHANGELOG } from '@trainingai/shared/changelog';

import { changelogPreview } from '../src/features/settings/data/changelog-preview.ts';

// #4143 item 13: About shows the first three points of the latest entry and "Show all" for the rest.

test('the first three points are shown and the rest are kept for "Show all"', () => {
  const { first, rest } = changelogPreview(CHANGELOG[0].changes);
  assert.equal(first.length, Math.min(3, CHANGELOG[0].changes.length));
  assert.deepEqual(first, CHANGELOG[0].changes.slice(0, 3));
  assert.deepEqual([...first, ...rest], CHANGELOG[0].changes);
});

test('a short entry has nothing behind "Show all"', () => {
  assert.deepEqual(changelogPreview(['a', 'b']), { first: ['a', 'b'], rest: [] });
  assert.deepEqual(changelogPreview(['a', 'b', 'c']).rest, []);
  assert.deepEqual(changelogPreview(['a', 'b', 'c', 'd']).rest, ['d']);
});
