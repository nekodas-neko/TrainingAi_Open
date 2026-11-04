import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMarkPartial,
  isPartialNight,
  PARTIAL_COPY,
  PARTIAL_DIMMED_FIELDS,
  partialErrorMessage,
} from '../src/features/health/data/partial-night-view.ts';

test('a night is partial when it carries a mark time, including the pending placeholder', () => {
  assert.equal(isPartialNight({ partialNightAt: null }), false);
  assert.equal(isPartialNight({}), false);
  assert.equal(isPartialNight({ partialNightAt: '1970-01-01T00:00:00.000Z' }), true);
  assert.equal(isPartialNight({ partialNightAt: '2026-10-28T01:00:00.000Z' }), true);
});

test('a night its source recorded incompletely is partial too, through the shared rule (#3600)', () => {
  assert.equal(isPartialNight({ recordingIncomplete: true }), true);
  assert.equal(isPartialNight({ recordingIncomplete: false, partialNightAt: null }), false);
  assert.equal(isPartialNight({ recordingIncomplete: null }), false);
});

test('only a measured night with an id offers the switch', () => {
  assert.equal(canMarkPartial({ id: 'a' }), true);
  assert.equal(canMarkPartial({ id: 'a', manualEntry: true }), false);
  assert.equal(canMarkPartial({ id: 'a', localOnly: true }), false);
  assert.equal(canMarkPartial({}), false);
});

test('a marked night dims durations and keeps heart rate, HRV and breathing at full strength', () => {
  for (const field of ['deepSleepHours', 'remSleepHours', 'lightSleepHours', 'awakHours', 'efficiency']) {
    assert.ok(PARTIAL_DIMMED_FIELDS.has(field), field);
  }
  for (const field of ['averageHrvMs', 'avgHeartRate', 'lowestHeartRate', 'respiratoryRate']) {
    assert.ok(!PARTIAL_DIMMED_FIELDS.has(field), field);
  }
});

test('the error state shows the store message, or a plain fallback', () => {
  assert.equal(partialErrorMessage(new Error('Only a night your ring or phone measured can be marked partial.')),
    'Only a night your ring or phone measured can be marked partial.');
  assert.equal(partialErrorMessage('boom'), PARTIAL_COPY.failed);
  assert.equal(partialErrorMessage(new Error('')), PARTIAL_COPY.failed);
});
