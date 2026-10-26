import assert from 'node:assert/strict';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { test } from 'node:test';
import {
  acwrZoneLabel,
  hrvBaselineBand,
  latestReading,
  readingCount,
  signedRate,
  sleepChips,
  sleepTimeRange,
  sleepWokeEnd,
  titleCaseWords,
  waterGoalText,
  waterText,
  weekdayAxis,
  weightPaceLine,
  wornSeconds,
} from '../src/features/health/data/body-view.ts';
import { bodySchema, sleepSchema } from '../src/features/health/data/models.ts';
import { ouraStatsSpec, ringBatterySpec } from '../src/features/health/data/body-models.ts';

const night = (extra: Record<string, unknown> = {}) =>
  sleepSchema.parse({ date: '2026-10-17', ...extra });
const body = (date: string, extra: Record<string, unknown> = {}) =>
  bodySchema.parse({ date, ...extra });

test('a fitted rate that rounds to minus zero prints +0, as the current app does', () => {
  assert.equal(signedRate(-0), '+0');
  assert.equal(signedRate(0), '+0');
  assert.equal(signedRate(-0.4), '-0.4');
  assert.equal(signedRate(0.3), '+0.3');
});

test('the sleep range starts at the raw bedtime and ends at the time you woke', () => {
  const row = night({
    sleepStart: '2026-10-16T12:00:00.000Z',
    sleepEnd: '2026-10-16T20:07:00.000Z',
    phaseWindowStart: '2026-10-16T12:00:00.000Z',
    phaseWindowEnd: '2026-10-16T20:03:00.000Z',
    sleepPhase5Min: '4' + '2'.repeat(96),
  });
  // UTC+10: 22:00 to 06:03. A night that ends asleep ends at the recorded wake, not the padded sleepEnd.
  assert.equal(
    sleepTimeRange(row, 'Australia/Brisbane')?.replace(/\s/g, ' '),
    '10:00 pm – 6:03 am',
  );
  // Twenty minutes lying awake before the window closes: the range ends where the sleep did (06:05 local), not at the window's 06:23.
  const inBed = night({
    sleepStart: '2026-10-16T12:00:00.000Z',
    sleepEnd: '2026-10-16T20:23:00.000Z',
    phaseWindowStart: '2026-10-16T12:00:00.000Z',
    phaseWindowEnd: '2026-10-16T20:23:00.000Z',
    sleepPhase5Min: '4' + '2'.repeat(96) + '4444',
  });
  assert.equal(sleepWokeEnd(inBed), '2026-10-16T20:05:00.000Z');
  assert.equal(sleepTimeRange(night(), 'Australia/Brisbane'), null);
  assert.equal(sleepTimeRange(undefined, 'Australia/Brisbane'), null);
});

test('sleep chips cover every vital and hide a zero Awake', () => {
  const chips = sleepChips(
    night({
      deepSleepHours: 1.5,
      remSleepHours: 1.25,
      lightSleepHours: 4,
      awakHours: 0,
      efficiency: 91,
      onsetLatencySec: 780,
      averageHrvMs: 64,
      lowestHeartRate: 48,
      respiratoryRate: 14.26,
    }),
  );
  assert.deepEqual(
    chips.stages.map((c) => c.key),
    ['deep', 'rem', 'light'],
  );
  assert.deepEqual(
    chips.vitals.map((c) => c.label),
    ['91% eff', '↓ 13m onset', 'HRV (overnight) 64ms', 'Lowest HR 48bpm', '14.3 br/m'],
  );
  const some = sleepChips(night({ awakHours: 0.5 }));
  assert.deepEqual(
    some.stages.map((c) => c.key),
    ['awake'],
  );
  assert.deepEqual(sleepChips(night()).vitals, []);
});

test('the weight pace line grades the weekly rate against the goal', () => {
  assert.deepEqual(weightPaceLine(90, 80, -0.5), { text: 'On track · -0.5 kg/wk', cue: 'good' });
  assert.equal(weightPaceLine(90, 80, -0.1)?.text, 'Slower than ideal pace · -0.1 kg/wk');
  assert.equal(weightPaceLine(90, 80, -1.4)?.cue, 'watch');
  assert.deepEqual(weightPaceLine(90, 80, 0.3), {
    text: 'Trending away from goal · +0.3 kg/wk',
    cue: 'bad',
  });
  assert.equal(weightPaceLine(80, 80, -0.5), null);
  assert.equal(weightPaceLine(90, null, -0.5), null);
  assert.equal(weightPaceLine(90, 80, null), null);
});

test('the HRV card is green and High above baseline, amber then red below it', () => {
  assert.deepEqual(hrvBaselineBand(5), { label: 'High', cue: 'good' });
  assert.deepEqual(hrvBaselineBand(0), { label: 'High', cue: 'good' });
  assert.deepEqual(hrvBaselineBand(-6), { label: 'Moderate', cue: 'watch' });
  assert.deepEqual(hrvBaselineBand(-20), { label: 'Low', cue: 'bad' });
});

test('the training load zone wording matches the current app', () => {
  assert.equal(acwrZoneLabel('optimal'), 'Optimal zone');
  assert.equal(acwrZoneLabel('very_high'), 'Overreaching risk');
  assert.equal(acwrZoneLabel('baselining'), null);
  assert.equal(acwrZoneLabel(undefined), null);
});

test('a heart tile shows the newest reading and a date only when it is not today', () => {
  const rows = [
    body('2026-10-15', { restingHeartRate: 55, hrvMs: 70 }),
    body('2026-10-17', { restingHeartRate: 52 }),
    body('2026-10-16', { hrvMs: 66 }),
  ];
  assert.deepEqual(latestReading(rows, 'restingHeartRate', '2026-10-17'), {
    value: 52,
    staleDate: null,
  });
  assert.deepEqual(latestReading(rows, 'hrvMs', '2026-10-17'), {
    value: 66,
    staleDate: '2026-10-16',
  });
  assert.equal(latestReading(rows, 'spo2Pct', '2026-10-17'), null);
});

test('the weekday axis labels every day of a fortnight, as the current app does, ending on the newest day', () => {
  const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(4 + i).padStart(2, '0')}`);
  const axis = weekdayAxis(dates);
  assert.equal(axis.length, dates.length);
  assert.equal(axis.filter((label) => label !== '').length, 14);
  // 17 October 2026 is a Saturday.
  assert.match(axis.at(-1)!, /Sat/);
  dates.forEach((date, i) => assert.equal(axis[i], formatDateDisplay(date, 'weekday')));
  // A caller that asks for fewer gets every second day from the newest back, blank between.
  const thinned = weekdayAxis(dates, 7);
  assert.equal(thinned.filter((label) => label !== '').length, 7);
  dates.forEach((date, i) => {
    assert.equal(thinned[i], (13 - i) % 2 === 0 ? formatDateDisplay(date, 'weekday') : '');
  });
  assert.deepEqual(weekdayAxis([]), []);
});

test('time worn is the elapsed day less non-wear time and never negative', () => {
  assert.equal(wornSeconds(3600, 36000), 32400);
  assert.equal(wornSeconds(40000, 36000), 0);
  assert.equal(wornSeconds(null, 36000), null);
});

test('wording helpers', () => {
  assert.equal(readingCount(1), 'From 1 reading');
  assert.equal(readingCount(7), 'From 7 readings');
  assert.equal(waterGoalText(2500), 'Goal: 2.5L');
  assert.equal(waterGoalText(800), 'Goal: 800ml');
  assert.equal(waterGoalText(0), null);
  assert.equal(waterGoalText(null), null);
  assert.equal(waterText(1800), '1.8L');
  assert.equal(waterText(250), '250ml');
  assert.equal(waterText(null), null);
  assert.equal(titleCaseWords('lower back'), 'Lower Back');
  assert.equal(titleCaseWords('mild'), 'Mild');
});

test('the ring resources accept the server payloads', () => {
  assert.equal(
    ouraStatsSpec('2026-10-17').schema.parse({ connected: false, daily: null }).connected,
    false,
  );
  assert.equal(
    ouraStatsSpec('2026-10-17').schema.parse({
      connected: true,
      daily: { nonWearTimeSec: 120, extra: 1 },
    }).daily?.nonWearTimeSec,
    120,
  );
  assert.equal(ringBatterySpec.schema.parse({ latest: null }).latest, null);
  assert.equal(
    ringBatterySpec.schema.parse({
      latest: { percent: 71, charging: null, tsMs: 1, ageMinutes: 4 },
    }).latest?.percent,
    71,
  );
});
