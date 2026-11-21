import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { bridgeHrGaps } from '@trainingai/shared/health/hr-gap-bridge';
import { boundedTicks } from '../src/shared/ui/chartScale';
import { hrDayChartColors } from '../src/shared/theme/tokens';
import {
  hrEstimatedPoints,
  hrWorkoutLabel,
  hrWorkoutWindows,
} from '../src/features/health/data/hr-trace';
import { SLEEP_LEGEND_MIN_FONT_SCALE, sleepStageLegend } from '../src/features/home/data/sleep-legend';

// The 20 Nov phone look (#2903 Home heart-rate card and Sleep legend, #2934 Zone minutes band).
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the y axis labels both ends of the fitted range, as chart.js does (#2903)', () => {
  // The current app's 10 Nov Home: "50, 60, 80 and 91".
  assert.deepEqual(boundedTicks(50, 91), [50, 60, 80, 91]);
  // A range that starts on a round value does not repeat it.
  assert.deepEqual(boundedTicks(60, 110), [60, 80, 100, 110]);
  for (const [lo, hi] of [[48, 133], [62, 110], [55, 99], [70, 72]] as const) {
    const ticks = boundedTicks(lo, hi);
    assert.equal(ticks[0], lo);
    assert.equal(ticks.at(-1), hi);
    assert.ok(ticks.length <= 5, `${lo}-${hi}: ${ticks}`);
    assert.deepEqual([...ticks].sort((a, b) => a - b), ticks);
    assert.equal(new Set(ticks).size, ticks.length);
  }
});

test('a round value too close to an end gives way to it (#2903)', () => {
  // 59 to 120: 60 would print over 59.
  const ticks = boundedTicks(59, 120);
  assert.equal(ticks[0], 59);
  assert.ok(!ticks.includes(60));
});

test('a flat range has the one tick (#2903)', () => {
  assert.deepEqual(boundedTicks(70, 70), [70]);
});

test('the Estimated line bridges gaps of 20 to 120 minutes and leaves longer ones open (#2903)', () => {
  const buckets = [
    { x: 400, y: 60 },
    { x: 410, y: 61 }, // 10 min: no bridge
    { x: 450, y: 70 }, // 40 min: bridged
    { x: 460, y: 72 },
    { x: 700, y: 90 }, // 240 min: a break, left open
  ];
  const bridge = bridgeHrGaps(buckets, 20, 120);
  assert.deepEqual(bridge.slice(0, 2), [
    { x: 410, y: 61 },
    { x: 450, y: 70 },
  ]);
  assert.ok(Number.isNaN(bridge[2].y));
  assert.equal(bridge.length, 3);
  assert.deepEqual(hrEstimatedPoints(buckets, null), [
    { x: 410, value: 61 },
    { x: 450, value: 70 },
    { x: 450, value: null },
  ]);
});

test('the Estimated line closes the hour a spring-forward day skips (#2903)', () => {
  // 01:45 to 03:00 is 75 wall-clock minutes but 15 real ones: no bridge.
  const buckets = [
    { x: 105, y: 60 },
    { x: 180, y: 62 },
  ];
  assert.equal(bridgeHrGaps(buckets, 20, 120, { fromMin: 120, toMin: 180 }).length, 0);
  assert.equal(bridgeHrGaps(buckets, 20, 120, null).length, 3);
});

test('no gap, no Estimated line (#2903)', () => {
  assert.deepEqual(hrEstimatedPoints([{ x: 0, y: 60 }, { x: 10, y: 61 }], null), []);
  assert.deepEqual(hrEstimatedPoints([], null), []);
});

test('a workout window carries its session name for the legend (#2903)', () => {
  const minuteOf = (ms: number) => ms / 60000;
  const windows = hrWorkoutWindows(
    [
      { sessionName: ' Pull ', startedAt: '1970-01-01T08:00:00Z', completedAt: '1970-01-01T09:00:00Z' },
      { startedAt: '1970-01-01T10:00:00Z', completedAt: '1970-01-01T11:00:00Z' },
    ],
    minuteOf,
  );
  assert.deepEqual(windows.map((w) => w.name), ['Pull', null]);
  assert.equal(hrWorkoutLabel('Pull'), 'Workout: Pull');
  assert.equal(hrWorkoutLabel(null), 'Workout');
});

test('the workout band is orange, not the activity teal (#2903)', async () => {
  assert.equal(hrDayChartColors.workoutBand, '#f97316');
  const card = await source('features/health/components/HrDayCard.tsx');
  assert.match(card, /color: hrDayChartColors\.workoutBand/);
  assert.doesNotMatch(card, /tones\.activity/);
  // The current app draws the workout window at 22% and the sleep window at 14%.
  assert.match(card, /HR_WORKOUT_BAND_OPACITY = 0\.22/);
  assert.match(card, /HR_SLEEP_BAND_OPACITY = 0\.14/);
});

test('Home asks for the Estimated line and the full-screen chart does not (#2903)', async () => {
  const home = await source('features/home/components/HomeWidgets.tsx');
  assert.match(home, /<HrDayCard embedded showEstimated/);
  const card = await source('features/health/components/HrDayCard.tsx');
  assert.match(card, /showEstimated = false/);
  assert.match(card, /boundedAxis/);
});

test('the sleep legend lists the four stages in order, with — for one not recorded (#2903)', () => {
  const colors = { deep: '#1', rem: '#2', light: '#3', awake: '#4' };
  const legend = sleepStageLegend(
    { deepSleepHours: 1.25, remSleepHours: 1.5, lightSleepHours: 4, awakHours: null },
    colors,
  );
  assert.deepEqual(
    legend.map((row) => [row.label, row.text, row.color]),
    [
      ['Deep', '1h 15m', '#1'],
      ['REM', '1h 30m', '#2'],
      ['Light', '4h 00m', '#3'],
      ['Awake', '—', '#4'],
    ],
  );
});

test('the sleep legend is one row that shrinks, never wraps (#2903)', async () => {
  const home = await source('features/home/components/HomeWidgets.tsx');
  const at = home.indexOf('sleepStageLegend(night');
  const legend = home.slice(home.indexOf('One row, as the current app', at));
  const row = legend.slice(0, legend.indexOf('{stages.map') + 12);
  assert.doesNotMatch(row, /<Stack[^>]*\bwrap\b/);
  assert.match(legend.slice(0, 1800), /adjustsFontSizeToFit/);
  assert.ok(SLEEP_LEGEND_MIN_FONT_SCALE > 0.5 && SLEEP_LEGEND_MIN_FONT_SCALE < 1);
});

test('Zone minutes keeps no status slot under the chart (#2934)', async () => {
  const trends = await source('features/activities/components/CardioTrends.tsx');
  const afterContent = trends.slice(trends.indexOf('</StableContent>'));
  assert.doesNotMatch(afterContent, /StatusIndicator/);
  assert.match(trends, /centredOverlayTop/);
});
