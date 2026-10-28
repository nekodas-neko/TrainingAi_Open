import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIGEST_NOTHING_YET,
  DIGEST_PREPARING,
  DIGEST_TODAY_ONLY,
  digestCardText,
} from '../src/features/nutrition/data/day-digest.ts';

// #3504: an empty day's `digest: null` is an answer, so the card stops saying "Preparing…".
const base = { isToday: true, answered: false, digest: null, error: null };

test('while the summary is on its way the card says it is preparing', () => {
  assert.equal(digestCardText(base), DIGEST_PREPARING);
});

test('once the server answers a day with nothing logged, the card says so instead of preparing', () => {
  assert.equal(digestCardText({ ...base, answered: true }), DIGEST_NOTHING_YET);
});

test('a summary is drawn, not replaced by a line', () => {
  assert.equal(digestCardText({ ...base, answered: true, digest: '**Good day.**' }), null);
});

test('a failure shows its message, and another day shows the today-only line', () => {
  assert.equal(digestCardText({ ...base, error: 'Could not load the day’s summary.' }), 'Could not load the day’s summary.');
  assert.equal(digestCardText({ ...base, isToday: false, answered: true }), DIGEST_TODAY_ONLY);
});

test('a summary already on screen survives a later failure, and another day never shows one', () => {
  assert.equal(digestCardText({ ...base, digest: 'x', error: 'Could not load the day’s summary.' }), null);
  assert.equal(digestCardText({ ...base, isToday: false, digest: 'x' }), DIGEST_TODAY_ONLY);
});

test('a failure after an empty answer shows the failure', () => {
  assert.equal(digestCardText({ ...base, answered: true, error: 'Could not load the day’s summary.' }), 'Could not load the day’s summary.');
});
