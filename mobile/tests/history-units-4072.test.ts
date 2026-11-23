import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { createWorkout } from '../src/features/workouts/logging/workout.ts';
import { storedLoad } from '../src/features/workouts/logging/preferences.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

// #4072 follow-up: the Exercise history sheet and the day log read a lift's loads in the unit the
// phone knows it is logged in, and in kilograms where it cannot know.
const at = (path: string) => new URL(path, import.meta.url).href;
const parents = new Set(
  [
    '../src/features/workouts/components/ExerciseHistory.tsx',
    '../src/features/workouts/screens/WorkoutHistoryScreen.tsx',
  ].map(at),
);
const stubs = at('./fixtures/unit-and-rm-stubs.ts');
const replaced =
  /^(react-native|(\.\.\/)+shared\/.*|\.\.\/components\/(ExerciseHistory|ResourceStatus)|\.\/(ResourceStatus|ExerciseHrTrendCard)|\.\.\/data\/(WorkoutDataProvider|HistoryQueueProvider|useWorkoutAction)|\.\.\/logging\/WorkoutJournalProvider)$/;
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
const { state, journal } = await import(stubs);
const { ExerciseHistory } = await import('../src/features/workouts/components/ExerciseHistory.tsx');
const { HistoryDay } = await import('../src/features/workouts/screens/WorkoutHistoryScreen.tsx');

const words = (el: ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const dumbbell = Number(storedLoad('22.5', 'lb'));
const f = loggingFixture();
const workout = createWorkout(f.session, programId, null, true, Date.UTC(2026, 10, 23, 2), f.uuid);
const lift = workout.exercises[0];

function sheetWith(sessionExerciseId?: string | null) {
  state.resources = {
    '/api/exercise-history': {
      exerciseType: 'weighted',
      entries: [
        {
          date: '2026/11/16 09:00',
          sessionName: 'Legs',
          estimated1rm: null,
          weightKg: [dumbbell],
          reps: [10],
          isDeload: false,
        },
      ],
    },
  };
  return words(createElement(ExerciseHistory, { name: 'Dumbbell Calf Raise', sessionExerciseId }));
}

test('the history sheet opened from a pound lift reads its sets in pounds', () => {
  state.units = { [lift.id]: 'lb' };
  const shown = sheetWith(lift.id);
  assert.match(shown, /Set 1 · 22\.5 lb × 10 reps/);
  assert.doesNotMatch(shown, /kg ×/);
});

test('the history sheet opened from a kilogram lift, or from no lift, reads kilograms', () => {
  state.units = { [lift.id]: 'kg' };
  assert.match(sheetWith(lift.id), /Set 1 · 10\.21 kg × 10 reps/);
  state.units = { [lift.id]: 'lb' };
  assert.match(sheetWith(null), /Set 1 · 10\.21 kg × 10 reps/, 'no id, no unit to know');
  assert.match(sheetWith(undefined), /10\.21 kg/);
  state.units = {};
});

function dayRow(logId: string) {
  return {
    name: 'Dumbbell Calf Raise',
    sessionName: 'Legs',
    exerciseType: 'weighted',
    weightKg: dumbbell,
    setWeights: [dumbbell],
    sets: 1,
    reps: [10],
    timeToCompleteSet: null,
    loggedAt: null,
    exerciseLogId: logId,
    workoutSessionId: 'w-1',
  };
}

test('a day-log row this phone can tie to a pound lift prints pounds; an unknown row stays kilograms', () => {
  journal.workouts = [{ ...workout, exercises: [{ ...lift, logId: 'known-log' }] }];
  state.units = { [lift.id]: 'lb' };
  state.resources = {
    '/api/day-log': { date: '2026/11/16', exercises: [dayRow('known-log'), dayRow('other-phone-log')] },
  };
  const compact = words(createElement(HistoryDay, { date: '2026/11/16', compact: true, readOnly: true }));
  assert.equal(compact.match(/22\.5 lb/g)?.length, 1, 'the known row');
  assert.equal(compact.match(/10\.21 kg/g)?.length, 1, 'the row from elsewhere stays in kilograms');
  const full = words(createElement(HistoryDay, { date: '2026/11/16' }));
  assert.match(full, /Set 1 · 22\.5 lb × 10 reps/);
  assert.match(full, /Set 1 · 10\.21 kg × 10 reps/);
  journal.workouts = [];
  state.units = {};
});

test('a re-logged lift reads the unit chosen for the lift it repeats', () => {
  const relog = { ...lift, id: 'relog-id', relogOf: lift.id, logId: 'relog-log' };
  journal.workouts = [{ ...workout, exercises: [relog] }];
  state.units = { [lift.id]: 'lb' };
  state.resources = { '/api/day-log': { date: '2026/11/16', exercises: [dayRow('relog-log')] } };
  assert.match(words(createElement(HistoryDay, { date: '2026/11/16', compact: true, readOnly: true })), /22\.5 lb/);
  journal.workouts = [];
  state.units = {};
});
