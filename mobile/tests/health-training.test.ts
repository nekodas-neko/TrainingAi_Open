import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityRow,
  calendarMarks,
  movementRows,
  muscleSetsLabel,
  periodizationRow,
  trendSeries,
  weekActivities,
} from '../src/features/health/data/training-view.ts';
import { overlayCalories } from '../src/features/activities/data/models.ts';
import { monthGrid } from '../src/shared/ui/monthGrid.ts';

const walk = {
  id: 'a',
  date: '2026-10-14',
  title: 'Walk',
  activityType: 'walking',
  startTime: '07:05',
  durationMin: 42.4,
  distanceKm: null,
  caloriesBurned: 180.6,
};

test('an activity row shows clock time and short date, and kcal without a distance dash', () => {
  const row = activityRow(walk);
  assert.equal(row.subtitle, '14 Oct · 7:05 am · 42 min');
  assert.deepEqual(row.facts, ['181 kcal']);
  assert.deepEqual(activityRow({ ...walk, distanceKm: 3.456, caloriesBurned: null }).facts, [
    '3.46 km',
  ]);
  assert.deepEqual(activityRow({ ...walk, caloriesBurned: null }).facts, []);
});

test('an imported activity type reads as words', () => {
  assert.equal(
    activityRow({ ...walk, title: 'EXERCISE_TYPE_STAIR_CLIMBING' }).title,
    'Stair Climbing',
  );
  assert.equal(activityRow({ ...walk, title: null }).title, 'walking');
});

test('only this week counts, whichever date separator the log used', () => {
  const logs = [{ date: '2026/10/12' }, { date: '2026-10-11' }, { date: '2026-10-15' }];
  assert.deepEqual(weekActivities(logs, '2026-10-12'), [logs[0], logs[2]]);
});

test('muscle counts agree with their number and read "3 / 13 sets"', () => {
  assert.equal(muscleSetsLabel(1, null), '1 set');
  assert.equal(muscleSetsLabel(3, null), '3 sets');
  assert.equal(muscleSetsLabel(3, 13), '3 / 13 sets');
  assert.equal(muscleSetsLabel(1, 9), '1 / 9 sets');
});

test('a periodization row counts its sessions and says Yesterday', () => {
  const state = { phase: 'accumulation', sessionsInPhase: 1, baselineComplete: true };
  assert.deepEqual(periodizationRow({ state, lastTrainedDaysAgo: 1 }), {
    phase: 'accumulation',
    label: 'Accum. · 1 session',
    recency: 'Yesterday',
  });
  assert.equal(periodizationRow({ state, lastTrainedDaysAgo: 4 }).recency, '4d ago');
  assert.equal(periodizationRow({ state, lastTrainedDaysAgo: null }).recency, 'Never trained');
  assert.equal(
    periodizationRow({
      state: { phase: 'baseline', baselineComplete: false },
      lastTrainedDaysAgo: null,
    }).label,
    'Baseline needed',
  );
  assert.deepEqual(periodizationRow({ state: null, lastTrainedDaysAgo: 2 }), {
    phase: 'baseline',
    label: 'No data',
    recency: null,
  });
});

test('movement balance rounds counts to whole sets and scales bars to the biggest row', () => {
  const { rows, total } = movementRows([
    { muscle: 'chest', sets: 251.5 },
    { muscle: 'lats', sets: 125.75 },
    { muscle: 'quads', sets: 0 },
  ]);
  assert.equal(total, 377.25);
  const push = rows.find((row) => row.key === 'push')!;
  assert.equal(push.sets, '252 sets');
  assert.equal(push.percent, '67%');
  assert.equal(push.fraction, 1);
  assert.equal(rows.find((row) => row.key === 'pull')!.fraction, 0.5);
  assert.equal(rows.find((row) => row.key === 'legs')!.sets, '0 sets');
});

test('a 14-day trend trims leading gaps, labels weekdays and counts the missing days', () => {
  const days = [
    { date: '2026-10-05', v: null },
    { date: '2026-10-06', v: 40 },
    { date: '2026-10-07', v: null },
    { date: '2026-10-08', v: 50 },
  ];
  const series = trendSeries(days, (day) => day.v)!;
  assert.equal(series.points.length, 3);
  assert.deepEqual(series.axisLabels, ['Tue', 'Wed', 'Thu']);
  assert.equal(series.missing, '1 day missing');
  assert.equal(
    trendSeries(days, () => null),
    null,
  );
  assert.equal(
    trendSeries(undefined, () => 1),
    null,
  );
  assert.equal(trendSeries([{ date: '2026-10-06' }], () => 1)!.missing, null);
});

test('an on-device activity keeps the calories the user typed or the server estimated', () => {
  const server = { caloriesBurned: 210, durationMin: 30, distanceKm: null };
  assert.equal(overlayCalories({ caloriesBurned: 150, durationMin: 30 }, server), 150);
  assert.equal(overlayCalories({ durationMin: 30 }, server), 210);
  assert.equal(overlayCalories({ durationMin: 45 }, server), null);
  assert.equal(overlayCalories({ durationMin: 30, distanceKm: 5 }, server), null);
  const ran = { caloriesBurned: 300, durationMin: 30, distanceKm: 5 };
  assert.equal(overlayCalories({ durationMin: 30, distanceKm: 5 }, ran), 300);
  assert.equal(overlayCalories({ durationMin: 30, distanceKm: 6 }, ran), null);
  assert.equal(overlayCalories({ durationMin: 30 }, ran), null);
  assert.equal(overlayCalories({ durationMin: 30 }, undefined), null);
  assert.equal(overlayCalories({ durationMin: 30 }, { ...server, caloriesBurned: null }), null);
});

test('the calendar gives a session dot per trained session and one activity dot, whatever the separator', () => {
  const { markers, dots } = calendarMarks({
    month: '2026-10',
    trainedDays: { '2026/10/05': ['Push'], '2026-10-06': ['Pull', 'Legs'] },
    activityDays: { '2026/10/05': ['Walk'], '2026-10-09': ['Run'] },
    activities: [
      { date: '2026-10-09', title: 'Run' },
      { date: '2026-10-09', title: 'Swim' },
      { date: '2026-09-30', title: 'Other month' },
    ],
    workouts: [
      { date: '2026-10-06', status: 'completed', sessionName: 'Pull' },
      { date: '2026-10-07', status: 'completed', sessionName: 'Push' },
      { date: '2026-10-08', status: 'abandoned', sessionName: 'Legs' },
      { date: '2026-11-01', status: 'completed', sessionName: 'Legs' },
    ],
    sessionColor: (name) => `s:${name}`,
    activityColor: 'act',
  });
  assert.deepEqual(dots['2026-10-05'], ['s:Push', 'act']);
  assert.deepEqual(dots['2026-10-06'], ['s:Pull', 's:Legs']);
  assert.deepEqual(dots['2026-10-07'], ['s:Push']);
  assert.deepEqual(dots['2026-10-09'], ['act']);
  assert.deepEqual(markers['2026-10-09'], ['Run', 'Swim']);
  assert.deepEqual(markers['2026-10-05'], ['Push', 'Walk']);
  assert.deepEqual(Object.keys(dots).sort(), [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-09',
  ]);
});

test('a month grid takes 4, 5 or 6 Monday-first rows', () => {
  assert.deepEqual(monthGrid('2026-02'), { first: 6, count: 28, cells: 35, rows: 5 });
  assert.equal(monthGrid('2021-02').rows, 4);
  assert.equal(monthGrid('2026-04').rows, 5);
  assert.equal(monthGrid('2026-08').rows, 6);
});
