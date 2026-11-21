import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';
import type { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';

// #3734 review: the workout screen's PiP hook, run with `react` swapped for a runner that commits
// as React does and the native module for one that records what it is told.
const hook = new URL('../src/features/workouts/pip/usePictureInPicture.ts', import.meta.url).href;
const runner = new URL('./fixtures/hook-runner.ts', import.meta.url).href;
const native = new URL('./fixtures/pip-native-stub.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === hook) {
      if (specifier === 'react') return { url: runner, shortCircuit: true };
      if (specifier === '../../../integrations/pip/platform') return { url: native, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { useWorkoutPip } = await import(hook);
const { render, unmount } = await import(runner);
const { calls } = (await import(native)) as typeof import('./fixtures/pip-native-stub.ts');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const workout = {
  id: id(1),
  status: 'active',
  sessionName: 'Push A',
  startedAt: Date.now() - 600_000,
  pausedAt: null,
  pausedMs: 0,
  restAdjustmentSeconds: 0,
  restAnchor: null,
  rest: null,
  runningSet: null,
  soloExerciseId: null,
  flow: { stage: 'exercise', exerciseId: id(2) },
  exercises: [
    {
      id: id(2),
      logId: id(2),
      name: 'Bench press',
      exerciseType: 'weighted',
      weightUnit: 'kg',
      retired: false,
      relogOf: null,
      skipped: false,
      supersetGroup: null,
      effortVsPlan: null,
      effortSource: null,
      effortShown: false,
      sets: [0, 1].map((i) => ({
        id: id(100 + i),
        weight: '60',
        reps: '8',
        startedAt: null,
        completedAt: null,
        restAfterSec: null,
        planned: { number: i + 1, reps: 8, percent: 70, restSeconds: 120 },
        plannedWeight: 60,
        rpe: null,
        rpeSource: null,
        suggestionHandled: false,
      })),
    },
  ],
} as unknown as WorkoutRecord;
const controller = { showEffort: async () => {} } as unknown as WorkoutJournalStore;

test('an accent change mid-workout redraws the window and never leaves it idle', () => {
  const first = render(() => useWorkoutPip(workout, controller, '#00c84e'));
  assert.equal(calls.at(-1)![0], 'ready');
  const second = render(() => useWorkoutPip(workout, controller, '#3b82f6'));
  assert.deepEqual([calls.at(-1)![0], calls.at(-1)![1]?.accent], ['ready', '#3b82f6']);
  assert.ok(calls.every(([phase]) => phase !== 'idle'), 'never idle while the workout is open');
  assert.equal(second, first, 'one reporter for the workout');
  unmount();
  assert.equal(calls.at(-1)![0], 'idle', 'idle once the screen closes');
});
