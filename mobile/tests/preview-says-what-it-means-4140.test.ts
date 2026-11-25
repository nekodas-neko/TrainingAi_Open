import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { foodAmount } from '../src/features/nutrition/data/display.ts';
import { sessionFacts } from '../src/features/home/data/recommendation-presentation.ts';
import { timelineCardContent } from '../src/features/home/data/timeline-presentation.ts';
import { formatSetLoad } from '../src/features/workouts/logging/targets.ts';
import { weekRangeLabel } from '../src/features/health/data/week-view.ts';
import { itemTitle } from '../src/features/activities/data/sync-health.ts';

// #4140: counts say "1 serving" and dates say "24 Nov", through the shared helpers.

const src = (path: string) =>
  readFileSync(new URL(`../src/features/${path}`, import.meta.url), 'utf8');

const log = (quantityMultiplier: number) => ({ quantityMultiplier, foodItem: { servingSizeG: 100 } });

test('a food amount is "1 serving", "2 servings", "1.5 servings"', () => {
  assert.equal(foodAmount(log(1)), '1 serving · 100 g');
  assert.equal(foodAmount(log(2)), '2 servings · 200 g');
  assert.equal(foodAmount(log(1.5)), '1.5 servings · 150 g');
  assert.equal(foodAmount(log(0.5)), '0.5 servings · 50 g');
});

test('Home card facts say "1 exercise" and "2 exercises"', () => {
  const text = (n: number) =>
    sessionFacts({ durationMinutes: null, exercises: new Array(n).fill({}) }, '2026-11-24')[0].text;
  assert.equal(text(1), '1 exercise');
  assert.equal(text(2), '2 exercises');
});

test('the logger says "1 rep" for a single rep and keeps a half-typed value as typed', () => {
  const bw = { exerciseType: 'bodyweight' as const, weightUnit: 'kg' as const };
  assert.equal(formatSetLoad(bw, { weight: '0', reps: '1' }), '1 rep');
  assert.equal(formatSetLoad(bw, { weight: '0', reps: '8' }), '8 reps');
  assert.equal(formatSetLoad(bw, { weight: '5', reps: '1' }), '+5 kg × 1 rep');
});

test('a timeline workout card says "1 set" and "1 exercise"', () => {
  const card = (sets: number, exerciseCount: number) =>
    timelineCardContent({ type: 'workout', sets, exerciseCount } as never).metrics.map((m) => m.text);
  assert.deepEqual(card(1, 1), ['1 set', '1 exercise']);
  assert.deepEqual(card(12, 3), ['12 sets', '3 exercises']);
});

test('a date reads "24 Nov", in the week range and in a sync-health row', () => {
  assert.equal(weekRangeLabel('2026-11-24', '2026-11-30'), '24 Nov – 30 Nov 2026');
  assert.equal(
    itemTitle({ list: 'rows', id: 'a', label: 'Activity', date: '2026-11-24' } as never),
    'Activity — 24 Nov',
  );
});

test('no private day-month table or plural copy is left in the week view or timeline', () => {
  assert.doesNotMatch(src('health/data/week-view.ts'), /MONTHS|function dayMonth/);
  assert.doesNotMatch(src('home/data/timeline-presentation.ts'), /const plural\s*=/);
});

const DATE_SITES: [string, RegExp][] = [
  ['health/components/BodyWeightCards.tsx', /formatDateDisplay\(weightDate/],
  ['workouts/components/SessionExerciseList.tsx', /formatDateDisplay\(exercise\.lastDate/],
  ['workouts/components/PreviousSession.tsx', /Source: \{formatDateDisplay\(/],
  ['workouts/screens/GuidedWorkoutScreen.tsx', /formatDateDisplay\(exercise\.lastDate/],
  ['workouts/components/ExerciseHistory.tsx', /formatDateDisplay\(entry\.date/],
  ['workouts/components/InjuryManager.tsx', /since \{formatDateDisplay\(/],
  ['health/components/MuscleStatusCard.tsx', /Resolved \{formatDateDisplay\(/],
  ['health/components/MetricHistorySheet.tsx', /title=\{formatDateDisplay\(row\.date/],
  ['health/components/ActivityDetails.tsx', /\{formatDateDisplay\(log\.date/],
  ['health/components/DoseVitalsCard.tsx', /\{formatDateDisplay\(dose\.date/],
  ['activities/screens/BaselinesScreen.tsx', /formatDateDisplay\(last!\.date/],
];

for (const [file, wants] of DATE_SITES) {
  test(`${file} prints its date through formatDateDisplay`, () => {
    assert.match(src(file), wants);
  });
}

const COUNT_SITES: [string, RegExp][] = [
  ['workouts/screens/WorkoutHistoryScreen.tsx', /plural\(\s*entries\s*\.filter/],
  ['workouts/components/SessionSelectionCard.tsx', /plural\(session\.exercises\.length/],
  ['workouts/screens/ExerciseLibraryScreen.tsx', /plural\(exercises\.length/],
  ['admin/components/AdminExercisesPanel.tsx', /plural\(shown\.length/],
  ['programs/SessionEditor.tsx', /plural\(block\.exercises\.length/],
  ['workouts/screens/WorkoutLogScreen.tsx', /plural\(result\.exercises/],
  ['workouts/components/ExercisePreviewCard.tsx', /plural\(exercise\.setCount/],
  ['workouts/components/SessionExerciseList.tsx', /plural\(exercise\.setCount/],
  ['meal-plans/components/MealPlansSheet.tsx', /plural\(plan\.mealsPerDay/],
  ['workouts/components/ExerciseDetails.tsx', /plural\(x\.reps/],
  ['workouts/components/NextPrescription.tsx', /plural\(set\.reps/],
  ['workouts/components/PreviousSession.tsx', /plural\(reps/],
  ['workouts/components/ExerciseHistory.tsx', /plural\(reps/],
];

for (const [file, wants] of COUNT_SITES) {
  test(`${file} pluralises its count`, () => {
    assert.match(src(file), wants);
  });
}

test('the builder wording is gone from what a person reads', () => {
  const gone: [string, RegExp][] = [
    ['activities/screens/WalkScreen.tsx', /deferred device/],
    ['workouts/components/WorkoutClocks.tsx', /Planning allowance|budget\./],
    ['workouts/screens/WorkoutHistoryScreen.tsx', /est\.\{' '\}|toUpperCase\(\)\} kcal/],
    ['health/components/BodyPanel.tsx', /is deferred|Devices & integrations/],
    ['collection/components/LadderCard.tsx', /\}provisional/],
    ['settings/components/SyncHealthCard.tsx', /upload queue/],
  ];
  for (const [file, pattern] of gone) assert.doesNotMatch(src(file), pattern, file);
});
