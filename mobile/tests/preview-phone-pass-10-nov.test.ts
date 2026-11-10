import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hrWorkoutWindows } from '../src/features/health/data/hr-trace';
import { createTheme } from '../src/shared/theme/theme';

// Fixes from the 10 Nov phone pass on Preview build 448721. Screens import React Native, which this
// runner cannot load, so the wiring is read as text; the logic behind it runs for real.
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('a Sleep request is honoured once, so returning to Health does not reopen the sheet (#3703)', async () => {
  const text = await source('features/health/screens/HealthScreen.tsx');
  const effect = text.slice(text.indexOf('const handledSleep'), text.indexOf('}, [sleepRequest]);'));
  assert.match(effect, /sleepRequest\.count > handledSleep\.current/);
  assert.match(effect, /handledSleep\.current = sleepRequest\.count;/);
  // Health is retained behind an <Activity>, whose hidden-to-visible switch re-runs this effect.
  assert.match(await source('shared/ui/RetainedView.tsx'), /<Activity mode=/);
});

test('the zone-minutes chart fits the current app’s 160 px box and its labels are never cut (#2934)', async () => {
  const trends = await source('features/activities/components/CardioTrends.tsx');
  const content = trends.slice(trends.indexOf('<StableContent'), trends.indexOf('loading={!data'));
  assert.match(content, /key=\{view\}/, 'each tab measures its own height');
  assert.match(content, /minHeight=\{theme\.sizes\.hrChartHeight\}/);
  assert.doesNotMatch(content, /touchTarget/, 'no reserve beyond the chart box');
  const zones = trends.slice(trends.indexOf('label="Weekly zone minutes"'), trends.indexOf('bars={'));
  assert.match(zones, /compactAxisLabels/);
  assert.match(zones, /height=\{theme\.sizes\.hrChartHeight - \(theme\.typography\.axisTick\.lineHeight \?\? 0\)\}/);
  const chart = await source('shared/ui/StackedBarChart.tsx');
  const at = chart.lastIndexOf('{bar.label}');
  const label = chart.slice(at - 600, at);
  assert.match(label, /adjustsFontSizeToFit/);
  assert.match(label, /minimumFontScale=\{0\.7\}/);
  assert.match(label, /compactAxisLabels\s*\?\s*'axisTick'/);
});

test('logged workouts become chart windows by the current app’s rule (#2903 item 1)', () => {
  const minuteOf = (ms: number) => (ms - Date.UTC(2026, 10, 9, 14)) / 60000; // Brisbane midnight
  const windows = hrWorkoutWindows(
    [
      { startedAt: '2026-11-09T21:51:00.000Z', completedAt: '2026-11-09T23:11:00.000Z' },
      { startedAt: '2026-11-10T01:00:00.000Z', completedAt: null },
      { startedAt: '2026-11-10T03:00:00.000Z', completedAt: '2026-11-10T02:00:00.000Z' },
      { startedAt: '7:51 am', completedAt: '9:11 am' },
    ],
    minuteOf,
  );
  assert.deepEqual(windows, [{ from: 7 * 60 + 51, to: 9 * 60 + 11 }]);
});

test('the Heart rate card reads workout instants, not the day log’s display strings (#2903 item 1)', async () => {
  const card = await source('features/health/components/HrDayCard.tsx');
  assert.match(card, /useWorkoutResource\(daySessionsSpec\(today\)\)/);
  assert.match(card, /hrWorkoutWindows\(workouts\.data\?\.sessions \?\? \[\], wallMinute\)/);
  assert.doesNotMatch(card, /workoutDurationsById/);
  const models = await source('features/workouts/data/models.ts');
  assert.match(models, /path: '\/api\/workout-sessions\/day'/);
  for (const path of [
    'features/workouts/logging/WorkoutJournalProvider.tsx',
    'features/workouts/data/HistoryQueueProvider.tsx',
  ]) {
    assert.match(await source(path), /'\/api\/workout-sessions\/day'/, `${path} refreshes it after a save`);
  }
  // The same strings were also fed to formatTimeOfDay on Workout history, which printed " →  · ".
  const history = await source('features/workouts/screens/WorkoutHistoryScreen.tsx');
  assert.doesNotMatch(history, /formatTimeOfDay\(state\.data\.workoutDurationsById/);
});

test('“That’s wrong” is the current app’s small underlined link, not a centred button (#2903 item 3)', async () => {
  const text = await source('features/home/components/HomeWidgets.tsx');
  const feedback = text.slice(text.indexOf('function HomeSleepFeedback'));
  const link = feedback.slice(0, feedback.indexOf('That’s wrong') + 20);
  assert.doesNotMatch(link, /<AppButton/);
  assert.match(link, /alignSelf: 'flex-start'/);
  assert.match(link, /minHeight: theme\.sizes\.touchTarget/);
  assert.match(link, /variant="caption"\s+tone="muted"/);
  assert.match(link, /textDecorationLine: 'underline'/);
});

test('the Collection “+N more” is light text on the scene, in both modes (#2903 item 4)', async () => {
  const pen = await source('features/collection/components/CollectionPen.tsx');
  const more = pen.slice(pen.indexOf('total > shown.length &&'), pen.indexOf('more\n'));
  assert.match(more, /color: theme\.colors\.onScene/);
  assert.doesNotMatch(more, /color: theme\.colors\.onSignal/);
  for (const mode of ['dark', 'light'] as const) {
    assert.equal(createTheme(mode, 'green').colors.onScene, '#ffffff');
  }
});

test('the Home sleep bar is the current app’s indigo-to-violet ramp on a violet track (#2903 item 5)', async () => {
  const text = await source('features/home/components/HomeWidgets.tsx');
  const bar = text.slice(text.indexOf('value={night.durationHours / goal}') - 40, text.indexOf('trackColor={sleepGoalBar.track}'));
  assert.match(bar, /gradient=\{sleepGoalBar\.gradient\}/);
  const progress = await source('shared/ui/ProgressBar.tsx');
  assert.match(progress, /<LinearGradient id=\{gradientId\} x1="0" x2="1"/);
  assert.match(progress, /backgroundColor: trackColor \?\? theme\.colors\.track/);
});
