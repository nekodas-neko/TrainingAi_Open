import { plannedMealRecorded } from '../src/features/meal-plans/data/recorded-meals.ts';
import { normalizeSupersets, moveItem } from '../src/features/programs/editor-model.ts';
import { unrecordedMealEstimatesAllowed } from '@trainingai/shared/nutrition/meal-logging-status';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/features/account/api/client.ts';
import {
  exerciseChoices,
  exerciseAlternatives,
} from '../src/features/programs/exercise-choice.ts';
import { ReviewSchema, reviewPayload } from '../src/features/programs/review-model.ts';
import { profilePatch } from '../src/features/settings/data/profile.ts';
import { recordedIntake } from '../src/features/nutrition/data/recorded-intake.ts';
import { explanationSpec, explanationData } from '../src/features/workouts/data/explanation.ts';
import {
  readingGroups,
  circularMeanMinutes,
} from '@trainingai/shared/profile/measured-overview';
import { performanceGroups } from '@trainingai/shared/profile/performance-overview';
import { estimateOneRm, withPrescribedBars } from '@trainingai/shared/1rm';
import { plateBreakdown } from '@trainingai/shared/workout/plate-loading';
import { loadSuggestion, expectedRpe } from '../src/features/workouts/logging/targets.ts';
import { createWorkout, mutationFor } from '../src/features/workouts/logging/workout.ts';
import { exerciseResult } from '../src/features/workouts/logging/summary.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

const exercise = (
  id: string,
  name: string,
  equipment: string[],
  main: string[],
  secondary: string[] = [],
) => ({
  id,
  name,
  equipment,
  muscles: [
    ...main.map((muscle) => ({ muscle, role: 'main' as const })),
    ...secondary.map((muscle) => ({ muscle, role: 'secondary' as const })),
  ],
  mergedInto: undefined,
  exerciseType: 'weighted' as const,
});
test('exercise alternatives respect equipment, primary roles, main muscles and merged entries', () => {
  const current = exercise('a', 'Barbell Bench', ['barbell'], ['Chest'], ['Triceps']);
  const dumbbell = exercise('b', 'Dumbbell Bench', ['dumbbell'], ['Chest'], ['Triceps']);
  const fly = exercise('c', 'Dumbbell Fly', ['dumbbell'], ['Chest']);
  const cable = exercise('d', 'Cable Press', ['cable'], ['Chest'], ['Triceps']);
  const merged = { ...dumbbell, id: 'e', mergedInto: 'b' };
  assert.deepEqual(
    exerciseAlternatives([current, dumbbell, fly, cable, merged], current, 'primary', [
      'dumbbell',
    ]).map((x) => x.id),
    ['b'],
  );
  assert.deepEqual(
    exerciseChoices([current, dumbbell, fly, cable, merged], 'bench', 'dumbbell', 'Arms').map(
      (x) => x.id,
    ),
    ['b'],
  );
});
test('workout review applies only selected changes and keeps cycle/permanent removal separate', () => {
  const row = {
    sessionExerciseId: 'a',
    name: 'Bench',
    role: 'primary',
    action: 'adjust',
    before: { sets: 3, reps: 8, pct: 70, restSec: 120 },
    after: { sets: 2, reps: 8, pct: 70, restSec: 120 },
    reason: null,
    guardAdjusted: false,
  };
  const review = ReviewSchema.parse({
    sessionId: 'one',
    sessionName: 'Push',
    totalBudgetMin: 60,
    reasoning: 'Fits time budget',
    proposal: {
      projectedDurationMin: 45,
      budgetMin: 50,
      fitsBudget: true,
      weeklyImpact: { Chest: -1 },
      exercises: [
        row,
        { ...row, sessionExerciseId: 'b', action: 'drop', after: null },
        { ...row, sessionExerciseId: 'c', action: 'drop', after: null },
        { ...row, sessionExerciseId: 'd', action: 'keep', guardAdjusted: true },
      ],
    },
  });
  const payload = reviewPayload(review, {
    a: 'reject',
    b: 'cycle',
    c: 'permanent',
    d: 'permanent',
  });
  assert.deepEqual(payload.adjustments, []);
  assert.deepEqual(payload.dropThisCycle, ['b']);
  assert.deepEqual(payload.dropPermanent, ['c']);
  assert.equal(reviewPayload(review, { a: 'cycle' }).adjustments[0].sets, 2);
});
test('profile updates validate dates/timezones and send only edited fields, including explicit clears', () => {
  assert.deepEqual(profilePatch({ heightCm: '180', sex: 'female' }, ['heightCm']), {
    heightCm: 180,
  });
  assert.deepEqual(profilePatch({ heightCm: '' }, ['heightCm']), { heightCm: null });
  assert.throws(() => profilePatch({ dateOfBirth: '2026-02-31' }, ['dateOfBirth']));
  assert.throws(() => profilePatch({ timezone: 'No/Such_Zone' }, ['timezone']));
  assert.deepEqual(profilePatch({ timezone: 'America/New_York' }, ['timezone']), {
    timezone: 'America/New_York',
  });
  assert.throws(() => profilePatch({ heightCm: 'Infinity' }, ['heightCm']));
});
test('profile summaries find each metric independently and distinguish daily estimates from scans', () => {
  const groups = readingGroups([
    { date: '2026-10-12', steps: 304, weightKg: null },
    { date: '2026-09-01', weightKg: 80, bmrKcal: 1700 },
    { date: '2026-09-04', weightKg: 81 },
  ]);
  assert.equal(
    groups.find((x) => x.title === 'Body composition')!.readings[0].asOf,
    '2026-09-04',
  );
  assert.ok(!groups.some((x) => x.title === 'Vitals'));
  assert.ok(
    groups.find((x) => x.title === 'Metabolism')!.readings[0].note?.includes('estimated'),
  );
  assert.equal(
    performanceGroups({ measuredRmr: [{ measuredOn: '2026-08-01', rmrKcal: 1800 }] }).length,
    1,
  );
  assert.equal(
    circularMeanMinutes(['before', 'after'], (iso) => (iso === 'before' ? 1430 : 10)),
    0,
  );
});
test('calorie displays ignore assumed meals, reflect pending edits and preserve genuinely imported intake', () => {
  const balance = {
    intakeKcal: 900,
    estimatedKcal: 500,
    expenditureKcal: 2200,
    budgetKcal: 2000,
  };
  assert.equal(
    recordedIntake({
      balance,
      calories: null,
      hasLogs: false,
      pending: false,
      allSkipped: false,
    }).intake,
    400,
  );
  const pending = recordedIntake({
    balance,
    calories: 150,
    hasLogs: true,
    pending: true,
    allSkipped: false,
  });
  assert.equal(pending.intake, 150);
  assert.equal(pending.remaining, 1850);
  assert.equal(pending.net, -2050);
  assert.equal(
    recordedIntake({ balance, calories: 0, hasLogs: false, pending: true, allSkipped: false })
      .intake,
    0,
  );
  assert.equal(
    recordedIntake({ balance, calories: 0, hasLogs: false, pending: false, allSkipped: true })
      .intake,
    0,
  );
  assert.equal(
    recordedIntake({
      balance: { ...balance, estimatedKcal: 0 },
      calories: 0,
      hasLogs: false,
      pending: false,
      allSkipped: false,
    }).intake,
    900,
  );
});
test('rounded prescribed bars preserve the same basis in local summaries and queued payloads', () => {
  const f = loggingFixture();
  const workout = createWorkout(
    f.session,
    programId,
    'Australia/Brisbane',
    false,
    Date.parse('2026-10-12T01:00:00Z'),
    f.uuid,
  );
  const x = workout.exercises[0];
  x.estimated1rm = 36.5;
  x.deloaded = false;
  for (const set of x.sets) {
    set.planned = { number: 1, reps: 10, percent: 70.5, restSeconds: 120, useFor1rm: true };
    set.plannedWeight = 27.5;
    set.weight = '27.5';
    set.reps = '10';
    set.completedAt = workout.startedAt + 60000;
  }
  assert.equal(exerciseResult(workout, x).estimate, 36.5);
  const payload = mutationFor(workout, {
    id: x.logId,
    domain: 'workout_log',
    exerciseId: x.id,
  }).payload;
  assert.equal(payload.prescriptionBasisKg, 36.5);
  assert.equal(
    estimateOneRm([{ weightKg: 27.5, reps: 10 }], {
      exerciseType: 'weighted',
      style: withPrescribedBars([{ pct: 70.5, reps: 10 }], [27.5], 36.5),
    }).estimated1rm,
    36.5,
  );
});
test('an untouched expected-effort picker never suggests reducing the next set', () => {
  const f = loggingFixture();
  const w = createWorkout(
    f.session,
    programId,
    null,
    false,
    Date.parse('2026-10-12T01:00:00Z'),
    f.uuid,
  );
  const x = w.exercises[0];
  x.sets[0].completedAt = w.startedAt + 1000;
  x.sets[0].rpe = 10;
  x.sets[0].rpeSource = 'expected';
  x.sets[0].reps = '2';
  assert.equal(loadSuggestion(w, x, x.sets[1]), null);
  assert.notEqual(expectedRpe(80, 3), expectedRpe(80, 10));
  assert.deepEqual(plateBreakdown(60)?.perSide, [20]);
});
test('recommendation explanations retain scoring signals and use day-partitioned caches', () => {
  const result = explanationSpec('2026-10-12').schema.parse({
    reason: 'Rotation',
    isRestDay: false,
    session: { id: 'one', name: 'Push' },
  });
  assert.equal(explanationData(result, 'one'), null);
  assert.notEqual(
    explanationSpec('2026-10-12').partition,
    explanationSpec('2026-10-13').partition,
  );
});
test('workout prose uses the authenticated backend and rejects partial stream errors', async () => {
  const calls: RequestInit[] = [];
  const client = createApiClient(
    'https://example.com',
    async () => 'secret',
    async (_url, init) => {
      calls.push(init!);
      return new Response('Muscles have recovered.', {
        headers: { 'content-type': 'text/plain' },
      });
    },
  );
  assert.equal(
    await client.get('/api/session-explain/insight', { sessionId: 'one' }),
    'Muscles have recovered.',
  );
  assert.equal((calls[0].headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.equal(calls[0].credentials, 'omit');
  const failed = createApiClient(
    'https://example.com',
    async () => 'secret',
    async () =>
      new Response('Partial\n[[AI_STREAM_ERROR]]', {
        headers: { 'content-type': 'text/plain' },
      }),
  );
  await assert.rejects(failed.get('/api/session-explain/insight'), /cut short/);
});

test('per-meal tracking disables legacy assumed intake for unknown and skipped meals', () => {
  assert.equal(unrecordedMealEstimatesAllowed([]), true);
  assert.equal(
    unrecordedMealEstimatesAllowed([
      { mealTypeId: 'breakfast', skipped: false, explicit: true },
    ]),
    false,
  );
  assert.equal(
    unrecordedMealEstimatesAllowed([
      { mealTypeId: 'breakfast', skipped: true, explicit: true },
    ]),
    false,
  );
});

test('editing exercise order preserves unrelated supersets and clears only broken groups', () => {
  const rows = [
    { id: 'a', supersetGroup: 0 },
    { id: 'b', supersetGroup: 0 },
    { id: 'c', supersetGroup: 1 },
    { id: 'd', supersetGroup: 1 },
    { id: 'e', supersetGroup: null },
  ];
  assert.deepEqual(
    normalizeSupersets(moveItem(rows, 1, 1)).map((x) => x.supersetGroup),
    [null, null, null, null, null],
  );
  assert.deepEqual(
    normalizeSupersets(moveItem(rows, 3, 1)).map((x) => x.supersetGroup),
    [0, 0, null, null, null],
  );
  assert.deepEqual(
    normalizeSupersets(moveItem(rows, 1, -1)).map((x) => x.supersetGroup),
    [0, 0, 1, 1, null],
  );
  assert.deepEqual(
    normalizeSupersets(rows.filter((x) => x.id !== 'd')).map((x) => x.supersetGroup),
    [0, 0, null, null],
  );
});

test('a food logged at breakfast cannot mark the same planned lunch ingredient recorded', () => {
  const meal = { name: 'Lunch', mealTypeId: 'lunch', ingredients: [{ name: 'Banana' }] };
  const row = { mealTypeId: 'breakfast', mealGroupName: null, foodItem: { name: 'Banana' } };
  assert.equal(plannedMealRecorded(meal, [row], []), false);
  assert.equal(plannedMealRecorded(meal, [{ ...row, mealTypeId: 'lunch' }], []), true);
});
