import assert from 'node:assert/strict';
import test from 'node:test';

import { limitedInputsNote } from '@trainingai/shared/health/readiness-input-labels';
import { weekDelta } from '@trainingai/shared/health/week-delta';
import { labelFor } from '../src/features/health/data/factor-label';
import { createTheme } from '../src/shared/theme/theme';
import {
  fixedValue,
  weekMuscleRows,
  weakestFactor,
  weekRangeLabel,
  weekdayInitial,
  weekdayName,
} from '../src/features/health/data/week-view';

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const v = ((n >> shift) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the week range reads "5 Oct – 11 Oct 2026"', () => {
  assert.equal(weekRangeLabel('2026-10-05', '2026-10-11'), '5 Oct – 11 Oct 2026');
  assert.equal(weekRangeLabel('2026-10-05', undefined), '5 Oct 2026');
});

test('the range prints the web\'s "d MMM" in every month', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((name, i) => {
    const mm = String(i + 1).padStart(2, '0');
    assert.equal(weekRangeLabel(`2026-${mm}-07`, `2026-${mm}-13`), `7 ${name} – 13 ${name} 2026`);
  });
  assert.equal(weekRangeLabel('2026-12-28', '2027-01-03'), '28 Dec – 3 Jan 2027');
});

test('bars are labelled M T W T F S S from their dates', () => {
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  assert.equal(days.map(weekdayInitial).join(''), 'MTWTFSS');
  // TalkBack reads the name, not the letter.
  assert.equal(days.map(weekdayName).join(' '), 'Monday Tuesday Wednesday Thursday Friday Saturday Sunday');
});

test('sleep keeps its decimal', () => {
  assert.equal(fixedValue(6, 1), '6.0');
  assert.equal(fixedValue(null, 1), '—');
});

test('a delta carries an arrow, and stress is better when it falls', () => {
  assert.deepEqual(weekDelta(7, 5, { unit: 'h', decimals: 1 }), { text: '↑ 2.0h on 5.0', cue: 'good' });
  assert.equal(weekDelta(40, 30, { unit: 'm', higherIsBetter: false }).cue, 'bad');
  assert.equal(weekDelta(20, 30, { higherIsBetter: false }).cue, 'good');
  assert.equal(weekDelta(60, 60).cue, 'same');
  assert.equal(weekDelta(60, null).text, 'No week before this one');
  assert.equal(weekDelta(null, 60).text, 'Not measured this week');
});

test('the delta and good-or-bad colours read on the card in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const theme = createTheme(mode, 'green');
    for (const color of [theme.progress.trendUp, theme.tones.checkin.foreground]) {
      assert.ok(contrast(color, theme.colors.surface) >= 4.5, `${mode} ${color}`);
    }
  }
});

test('muscle sets keep a half set and carry no program target', () => {
  assert.deepEqual(weekMuscleRows([{ muscle: 'chest', sets: 4.5 }]), [
    { muscle: 'chest', sets: 4.5, target: null },
  ]);
});

test('the weakest factor ignores a learning placeholder', () => {
  assert.equal(
    weakestFactor([
      { key: 'hrvBalance', label: 'HRV balance', score: 40 },
      { key: 'sleepBalance', label: 'Sleep balance', score: 50, provisional: true },
      { key: 'recoveryIndex', label: 'Recovery index', score: 20, provisional: true },
      { key: 'previousNight', label: 'Previous night', score: null },
    ]),
    'HRV balance',
  );
  assert.equal(weakestFactor([{ key: 'a', label: 'A', score: null }]), null);
});

test('REM sleep keeps its capitals, and the readiness factors resolve', () => {
  assert.equal(labelFor('rem_sleep'), 'REM sleep');
  assert.equal(labelFor('somethingNew'), 'Something new');
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
