import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  goalShownForPeriod,
  recommendationGoalsPatch,
} from '@trainingai/shared/nutrition/goal-recommendation-apply';

// Screens import React Native, which this runner cannot load, so the wiring is read as text. The
// behaviour behind each wire is tested where it lives (home.test.ts, preferences.test.ts).
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test("the Goals check-in's dismiss postpones the review on the server, behind an undo (#3669 item 1)", async () => {
  const text = await source('features/home/components/HomeBanners.tsx');
  const goals = text.slice(text.indexOf("type: 'goals' as const"), text.indexOf("type: 'day' as const"));
  assert.match(goals, /dismiss: \(\) => postponeGoals\(\)/);
  assert.match(text, /await store\.postponeGoals\(date\)/);
  assert.match(text, /await store\.cancelGoalsPostpone\(date\)/);
});

test('a first Collection load that failed offers Retry (#3669 item 2)', async () => {
  const text = await source('features/collection/screens/CollectionScreen.tsx');
  const branch = text.slice(text.indexOf('!collections && state.error'), text.indexOf('!collections ? ('));
  assert.match(branch, /<StateCard/);
  assert.match(branch, /action="Retry"/);
  assert.match(branch, /onAction=\{state\.refresh\}/);
});

test("phone-only health rows name the phone's own health store, never a fixed one (#3669 item 3)", async () => {
  for (const path of [
    'features/home/components/HomeTimeline.tsx',
    'features/health/components/MorningCheckinSheet.tsx',
    'features/activities/components/CardioTrends.tsx',
    'features/health/components/HealthNotice.tsx',
    'features/health/components/HealthSummary.tsx',
  ]) {
    const text = await source(path);
    assert.doesNotMatch(text, /Apple Health/, path);
    assert.match(text, /deviceHealthName/, path);
  }
  assert.doesNotMatch(await source('features/home/data/timeline.ts'), /Apple Health/);
  assert.match(
    await source('integrations/device-health/platform.android.ts'),
    /deviceHealthName = 'Health Connect'/,
  );
});

test('the account accent is synced once storage is open (#3669 item 4)', async () => {
  const text = await source('app/providers/LocalStorageProvider.tsx');
  assert.match(text, /<AppearanceAccountSync preferences=\{ready\.preferences\} \/>/);
  assert.match(await source('features/settings/AppearanceProvider.tsx'), /attachAccount\(dataReader \?\? null\)/);
});

test('the set-aside notice is acknowledged when its details are closed, not on a timer (#3669 item 7)', async () => {
  const screen = await source('features/home/screens/HomeScreen.tsx');
  assert.doesNotMatch(screen, /SET_ASIDE_SEEN_MS|setTimeout\([^)]*acknowledgeSetAside/);
  assert.match(screen, /onDetailsSeen=\{acknowledgeSetAside\}/);
  assert.match(await source('features/home/components/HomeHeader.tsx'), /onDetailsSeen=\{onDetailsSeen\}/);
  const indicator = await source('shared/ui/StatusIndicator.tsx');
  assert.match(indicator, /setDetails\(false\);\s*onDetailsSeen\?\.\(\);/);
});

test('a weekly-mode goal recommendation stores the daily figures (#3643)', async () => {
  const text = await source('features/nutrition/components/GoalRecommendation.tsx');
  assert.doesNotMatch(text, /=== 'weekly' \? 7/);
  assert.match(text, /recommendationGoalsPatch\(rec\.recommended/);
  assert.deepEqual(recommendationGoalsPatch({ stepsGoal: 10000, waterMl: 3000 }, { steps: true, water: true }), {
    stepsGoal: 10000,
    waterGoalMl: 3000,
  });
  assert.equal(goalShownForPeriod(10000, 'weekly'), 70000);
});

test("the reminders caption says times follow the profile's time zone, as they do since #3694 (#3683)", async () => {
  const text = await source('features/platform/components/IntegrationSettings.tsx');
  assert.doesNotMatch(text, /Times follow your phone’s local clock/);
  assert.match(text, /Times follow your profile’s time zone/);
});
