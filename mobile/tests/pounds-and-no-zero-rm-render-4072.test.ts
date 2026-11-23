import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { createWorkout, type WorkoutExercise } from '../src/features/workouts/logging/workout.ts';
import { storedLoad } from '../src/features/workouts/logging/preferences.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

// #4072 part 1 and #4077, rendered: the real screens, their React Native layer and providers swapped
// for the plain-HTML stubs in fixtures/. Only each screen's own imports are replaced.
const at = (path: string) => new URL(path, import.meta.url).href;
const parents = new Set(
  [
    '../src/features/workouts/components/ExerciseSummary.tsx',
    '../src/features/progress/StrengthScreen.tsx',
    '../src/features/workouts/components/SessionExerciseList.tsx',
    '../src/features/workouts/components/ExercisePreviewCard.tsx',
    '../src/features/workouts/components/NextPrescription.tsx',
  ].map(at),
);
const stubs = at('./fixtures/unit-and-rm-stubs.ts');
const replaced =
  /^(react-native|(\.\.\/)+shared\/.*|\.\/(WorkoutClocks|EffortQuestion|ExerciseHeading|ResourceCard|ResourceStatus)|\.\.\/health\/progressPresentation|\.\.\/workouts\/(WorkoutProvider|data\/WorkoutDataProvider|components\/(ResourceStatus|ExerciseHistory))|\.\.\/logging\/WorkoutJournalProvider|\.\.\/\.\.\/coach\/components\/LiftCoachMenu)$/;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && parents.has(context.parentURL) && replaced.test(specifier))
      return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { state } = await import(stubs);
const { ExerciseSummary } = await import('../src/features/workouts/components/ExerciseSummary.tsx');
const { StrengthScreen } = await import('../src/features/progress/StrengthScreen.tsx');
const { SessionExerciseList } = await import('../src/features/workouts/components/SessionExerciseList.tsx');
const { ExercisePreviewCard } = await import('../src/features/workouts/components/ExercisePreviewCard.tsx');
const { NextPrescription } = await import('../src/features/workouts/components/NextPrescription.tsx');

const words = (el: ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const dumbbell = storedLoad('22.5', 'lb');

const f = loggingFixture();
const T = Date.UTC(2026, 10, 23, 2);
const base = () => {
  const workout = createWorkout(f.session, programId, null, true, T, f.uuid);
  workout.isBaseline = false;
  return workout;
};
const done = (exercise: WorkoutExercise, weight: string): WorkoutExercise => ({
  ...exercise,
  sets: exercise.sets.map((set, i) => ({
    ...set,
    weight,
    reps: '10',
    startedAt: T + i * 100_000,
    completedAt: T + i * 100_000 + 40_000,
  })),
});

// ---- #4072 ---------------------------------------------------------------------------------------

test('the rest card lists a pound lift’s sets in pounds and a kilogram lift’s in kilograms', () => {
  const workout = base();
  const lb = done({ ...workout.exercises[0], weightUnit: 'lb', estimated1rm: null }, dumbbell);
  const shown = words(createElement(ExerciseSummary, { workout, exercise: lb }));
  assert.match(shown, /22\.5 lb × 10 reps/);
  assert.doesNotMatch(shown, /10\.2\d* kg/);
  const kg = done({ ...workout.exercises[0], weightUnit: 'kg', estimated1rm: null }, '60');
  assert.match(words(createElement(ExerciseSummary, { workout, exercise: kg })), /60 kg × 10 reps/);
});

test('"Up Next" names the next lift’s load in that lift’s own unit', () => {
  const workout = base();
  const current = done({ ...workout.exercises[0], estimated1rm: null }, '60');
  const next = { ...workout.exercises[0], weightUnit: 'lb' as const };
  next.sets = next.sets.map((set) => ({ ...set, weight: dumbbell }));
  assert.match(words(createElement(ExerciseSummary, { workout, exercise: current, next })), /Up Next .* 22\.5 lb/);
  const kgNext = { ...next, weightUnit: 'kg' as const, sets: next.sets.map((s) => ({ ...s, weight: '60' })) };
  assert.match(words(createElement(ExerciseSummary, { workout, exercise: current, next: kgNext })), /Up Next .* 60 kg/);
});

test('the session list and the exercise preview read a lift’s load by the unit its toggle chose', () => {
  const workout = base();
  const exercise = {
    ...workout.exercises[0],
    lastReps: [10],
    lastWeights: [Number(dumbbell)],
    lastDate: '2026-11-16',
    setCount: 1,
    sets: [],
  };
  state.units = { [exercise.id]: 'lb' };
  const list = words(createElement(SessionExerciseList, { exercises: [exercise], onSelect: () => {} }));
  assert.match(list, /Last: 22\.5 lb × 10/);
  state.units = {};
  assert.match(
    words(createElement(SessionExerciseList, { exercises: [exercise], onSelect: () => {} })),
    /Last: 10\.21 kg × 10/,
  );
  const planned = {
    ...exercise,
    exerciseType: 'weighted' as const,
    estimated1rm: 80,
    sets: [{ number: 1, reps: 10, percent: 50, restSeconds: 60 }],
  };
  state.units = { [exercise.id]: 'lb' };
  assert.match(words(createElement(ExercisePreviewCard, { exercise: planned, position: 1 })), /50% 1RM · 88.2 lb/);
  state.units = {};
  assert.match(words(createElement(ExercisePreviewCard, { exercise: planned, position: 1 })), /50% 1RM · 40 kg/);
  state.units = {};
});

test('the Next workout card reads each lift in its own unit', () => {
  const id = '40000000-0000-4000-8000-000000000001';
  state.next = {
    isRestDay: false,
    sessionName: 'Legs',
    source: 'saved',
    exercises: [
      {
        name: 'Dumbbell Calf Raise',
        sessionExerciseId: id,
        exerciseType: 'weighted',
        sets: [{ weightKg: Number(dumbbell), reps: 10 }],
      },
      { name: 'Squat', sessionExerciseId: 'other', exerciseType: 'weighted', sets: [{ weightKg: 100, reps: 5 }] },
    ],
  };
  state.units = { [id]: 'lb' };
  const shown = words(createElement(NextPrescription));
  assert.match(shown, /22\.5 lb × 10/);
  assert.match(shown, /100 kg × 5/);
  state.units = {};
});

// ---- #4077 ---------------------------------------------------------------------------------------

test('the exercise summary shows no previous value and no change when the previous estimate is 0 (weighted)', () => {
  const workout = base();
  const exercise = done({ ...workout.exercises[0], exerciseType: 'weighted', estimated1rm: 0, deloaded: false }, '60');
  const shown = words(createElement(ExerciseSummary, { workout, exercise }));
  assert.match(shown, /Previous — /, 'the previous value is a dash');
  assert.doesNotMatch(shown, /Previous 0/);
  assert.doesNotMatch(shown, /(^|\s)0 (kg|RM)/);
  assert.doesNotMatch(shown, /[+-]\d+(\.\d+)? kg/, 'no change line against a previous of 0');
  const real = done({ ...workout.exercises[0], exerciseType: 'weighted', estimated1rm: 70, deloaded: false }, '60');
  assert.match(words(createElement(ExerciseSummary, { workout, exercise: real })), /Previous 70 kg/);
});

test('the Strength screen never prints "0 RM" or "0 kg" for a lift with no estimate', () => {
  state.resources = {
    '/api/strength-trend': {
      exercises: [
        {
          name: 'Pull-up',
          exerciseType: 'bodyweight',
          history: [{ date: '2026-11-01', rm: 0 }],
          currentRm: 0,
          peakRm: 0,
          startRm: null,
          gainPct: null,
        },
      ],
    },
    '/api/personal-records': { records: [] },
    '/api/exercise-library': { exercises: [] },
  };
  const shown = words(createElement(StrengthScreen, { section: 'trend' }));
  assert.doesNotMatch(shown, /\b0 (RM|kg)\b/);
  assert.match(shown, /Peak: —/);
  assert.match(shown, /90d low: —/);
  state.resources['/api/strength-trend'] = {
    exercises: [
      {
        name: 'Squat',
        exerciseType: 'weighted',
        history: [{ date: '2026-11-01', rm: 90 }],
        currentRm: 100,
        peakRm: 100,
        startRm: 90,
        gainPct: 11,
      },
    ],
  };
  const real = words(createElement(StrengthScreen, { section: 'trend' }));
  assert.match(real, /100 kg/);
  assert.match(real, /Peak: 100 kg/);
});

test('a personal record with no estimate shows a dash, a real one its weight', () => {
  state.resources = {
    '/api/strength-trend': { exercises: [] },
    '/api/personal-records': {
      records: [
        { exerciseName: 'Dip', estimated1rm: 0, achievedAt: '2026-11-02T00:00:00Z' },
        { exerciseName: 'Bench', estimated1rm: 92.5, achievedAt: '2026-11-03T00:00:00Z' },
      ],
    },
    '/api/exercise-library': {
      exercises: [
        { name: 'Dip', exerciseType: 'bodyweight' },
        { name: 'Bench', exerciseType: 'weighted' },
      ],
    },
  };
  const shown = words(createElement(StrengthScreen, { section: 'records' }));
  assert.doesNotMatch(shown, /\b0 (RM|kg)\b/);
  assert.match(shown, /92\.5 kg/);
});
