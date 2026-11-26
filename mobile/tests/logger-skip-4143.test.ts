import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

import { skipExerciseMessage, skipGoesTo } from '../src/features/workouts/logging/logger-copy.ts';

// #4143 item 4: the Skip button has a visible label and its own confirmation naming the exercise.

const screen = () =>
  readFileSync(
    new URL('../src/features/workouts/screens/GuidedWorkoutScreen.tsx', import.meta.url),
    'utf8',
  );

test('the skip confirmation names the exercise and says where Skip really lands', () => {
  assert.equal(
    skipExerciseMessage('Back Squat', 'next'),
    'Skip Back Squat? Sets you have already logged on it stay saved. You move on to the next exercise.',
  );
  assert.equal(
    skipExerciseMessage('Back Squat', 'session'),
    'Skip Back Squat? Sets you have already logged on it stay saved. You go back to the session.',
  );
});

// The words are chosen by skipGoesTo; skipExercise is what actually moves the person. They must agree.
async function skipSetup(t: { after(fn: () => void): void }, count: number) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const controller = new WorkoutJournalStore(
    storage.account(f.connection.origin, f.connection.userId),
    f.connection,
    f.uuid,
    () => Date.UTC(2026, 9, 20, 0),
  );
  await controller.initialize();
  await controller.sync();
  const ids = [exerciseId, '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005'].slice(0, count);
  const session = {
    ...f.session,
    exercises: ids.map((id, i) => ({ ...f.session.exercises[0], id, name: `Exercise ${i + 1}` })),
  };
  const id = (await controller.start(session, programId, true))!;
  await controller.beginExercises(id);
  return { controller, id, workout: () => controller.getSnapshot().data.workouts[0], ids };
}

test('on a middle exercise the confirmation says next, and Skip moves to the next exercise', async (t) => {
  const f = await skipSetup(t, 3);
  assert.equal(skipGoesTo(f.workout()), 'next');
  await f.controller.skipExercise(f.id);
  assert.equal(workoutFlow(f.workout()).exerciseId, f.ids[1]);
  assert.notEqual(workoutFlow(f.workout()).stage, 'review');
});

test('on the last exercise the confirmation says session, and Skip lands on the session hub', async (t) => {
  const f = await skipSetup(t, 1);
  assert.equal(skipGoesTo(f.workout()), 'session');
  assert.match(skipExerciseMessage('Exercise 1', skipGoesTo(f.workout())), /You go back to the session\.$/);
  await f.controller.skipExercise(f.id);
  assert.equal(workoutFlow(f.workout()).stage, 'review');
});

test('the button beside Start Set carries a visible "Skip" label, not an empty title', () => {
  const src = screen();
  assert.match(src, /title="Skip"\s+icon="skip"/);
  assert.doesNotMatch(src, /title=""\s+icon="skip"/);
});

test('the skip confirmation no longer reuses the "recorded progress" line', () => {
  assert.match(screen(), /confirmation === 'skip'\s+\? skipExerciseMessage\(exercise\.name, skipGoesTo\(workout\)\)/);
});
