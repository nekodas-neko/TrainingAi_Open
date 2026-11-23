import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { createWorkout } from '../src/features/workouts/logging/workout.ts';
import { loggingFixture, programId } from './logging-fixture.ts';

// #4061: the set card, rendered. Its React Native layer, journal and voice are swapped for the
// plain-HTML stubs in fixtures/, so this runner renders the real component and lists its controls.
const card = new URL('../src/features/workouts/components/SetEntry.tsx', import.meta.url).href;
const stubs = new URL('./fixtures/set-entry-stubs.ts', import.meta.url).href;
const stubbed = new Set([
  'react-native',
  '../../../shared/ui',
  '../../../shared/theme/ThemeProvider',
  '../../../integrations/feedback/haptics',
  '../logging/WorkoutJournalProvider',
  './VoiceLogButton',
  '../voice/voice',
  '../voice/useVoiceEngine',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === card && stubbed.has(specifier)) return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { SetEntry } = await import(card);

const f = loggingFixture();
const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
const controls = (exercise = workout.exercises[0]) =>
  [...renderToStaticMarkup(
    createElement(SetEntry, { workout, exercise, set: exercise.sets[0], index: 0 }),
  ).matchAll(/data-ui="(\w+)" aria-label="([^"]*)"/g)].map((m) => `${m[1]}: ${m[2]}`);

test('#4061: the set card shows load, reps and units, and no RPE row', () => {
  const shown = controls();
  assert.deepEqual(shown, [
    'SegmentedControl: Weight display unit',
    'NumberWheel: Weight (kg)',
    'RepCounter: Reps for Bench press, set 1',
  ]);
  assert.ok(shown.every((x) => !/RPE|ChoiceScale/.test(x)));
});

test('#4061: a bodyweight set card has no RPE row either', () => {
  const exercise = { ...workout.exercises[0], exerciseType: 'bodyweight' as const };
  const shown = controls(exercise);
  assert.ok(shown.includes('RepCounter: Reps for Bench press, set 1'));
  assert.ok(shown.every((x) => !/RPE|ChoiceScale/.test(x)));
});
