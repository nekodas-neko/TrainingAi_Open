import assert from 'node:assert/strict';
import test from 'node:test';
import { limitedInputsNote } from '@trainingai/shared/health/readiness-input-labels';
import { labelFor } from '@trainingai/shared/health/contributor-labels';
import {
  fixedValue,
  weekDelta,
  weekMuscleRows,
  weakestFactor,
  weekRangeLabel,
  weekdayInitial,
} from '../src/features/health/data/week-view';

test('the week range reads "5 Oct – 11 Oct 2026"', () => {
  assert.equal(weekRangeLabel('2026-10-05', '2026-10-11'), '5 Oct – 11 Oct 2026');
  assert.equal(weekRangeLabel('2026-10-05', undefined), '5 Oct 2026');
});

test('bars are labelled M T W T F S S from their dates', () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  assert.equal(days.map(weekdayInitial).join(''), 'MTWTFSS');
});

test('sleep keeps its decimal', () => {
  assert.equal(fixedValue(6, 1), '6.0');
  assert.equal(fixedValue(null, 1), '—');
});

test('a delta carries an arrow, and stress is better when it falls', () => {
  assert.deepEqual(weekDelta(7, 5, { unit: 'h', decimals: 1 }), { text: '↑ 2.0 h on 5.0', cue: 'good' });
  assert.equal(weekDelta(40, 30, { unit: 'min', higherIsBetter: false }).cue, 'bad');
  assert.equal(weekDelta(20, 30, { higherIsBetter: false }).cue, 'good');
  assert.equal(weekDelta(60, 60).cue, 'same');
  assert.equal(weekDelta(60, null).text, 'No week before this one');
  assert.equal(weekDelta(null, 60).text, 'Not measured this week');
});

test('muscle sets keep a half set and carry no program target', () => {
  assert.deepEqual(weekMuscleRows([{ muscle: 'chest', sets: 4.25 }]), [
    { muscle: 'chest', sets: 4.3, target: null },
  ]);
});

test('the weakest factor ignores a learning placeholder', () => {
  assert.equal(
    weakestFactor([
      { label: 'HRV balance', score: 40 },
      { label: 'Sleep balance', score: 50, provisional: true },
      { label: 'Recovery index', score: 20, provisional: true },
      { label: 'Previous night', score: null },
    ]),
    'HRV balance',
  );
  assert.equal(weakestFactor([{ label: 'A', score: null }]), null);
});

test('REM sleep keeps its capitals, and the readiness factors resolve', () => {
  assert.equal(labelFor('rem_sleep'), 'REM sleep');
  assert.equal(labelFor('hrvBalance'), 'HRV balance');
  assert.equal(labelFor('restingHeartRate'), 'Resting heart rate');
});

test('a partial readiness score names what is missing', () => {
  assert.equal(limitedInputsNote([]), null);
  assert.equal(
    limitedInputsNote(['sleep', 'hrv']),
    'Based on part of the usual picture — no sleep stages and overnight HRV today, so those factors sit at neutral.',
  );
});
