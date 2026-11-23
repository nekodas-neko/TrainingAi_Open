import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import { workoutBack } from '../src/features/workouts/logging/back.ts';
import { pipCommand } from '../src/features/workouts/pip/pip.ts';
import { workoutCalendarEvent } from '../src/features/platform/data/CalendarStore.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const secondId = '10000000-0000-4000-8000-000000000004';
const thirdId = '10000000-0000-4000-8000-000000000005';

// A session of `count` exercises, started and past its warm-up, on the first exercise.
async function setup(t: { after(fn: () => void): void }, count = 2) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const sent: unknown[] = [];
  const connection = {
    ...f.connection,
    post: async (path: string, body: unknown) => {
      sent.push(body);
      return f.connection.post(path, body);
    },
  };
  let now = Date.UTC(2026, 9, 20, 0);
  const controller = new WorkoutJournalStore(
    storage.account(connection.origin, connection.userId),
    connection,
    f.uuid,
    () => now,
  );
  await controller.initialize();
  await controller.sync();
  const ids = [exerciseId, secondId, thirdId].slice(0, count);
  const session = {
    ...f.session,
    exercises: ids.map((id, index) => ({
      ...f.session.exercises[0],
      id,
      name: `Exercise ${index + 1}`,
    })),
  };
  const workout = () => controller.getSnapshot().data.workouts[0];
  const id = (await controller.start(session, programId, true))!;
  await controller.beginExercises(id);
  const record = async (exercise: string, setIndex: number) => {
    const set = workout().exercises.find((x) => x.id === exercise)!.sets[setIndex];
    await controller.startSet(id, exercise, set.id);
    now += 30_000;
    await controller.recordSet(id, exercise, set.id);
    now += 5_000;
    return set;
  };
  const start = async (exercise: string, setIndex: number) => {
    const set = workout().exercises.find((x) => x.id === exercise)!.sets[setIndex];
    await controller.startSet(id, exercise, set.id);
  };
  // Records every set of an exercise and moves on to the next one's preparation.
  const completeAndAdvance = async (exercise: string) => {
    for (let i = 0; i < workout().exercises.find((x) => x.id === exercise)!.sets.length; i++) {
      await record(exercise, i);
    }
    await controller.advanceExercise(id);
  };
  return { ...f, controller, workout, id, sent, record, start, completeAndAdvance };
}

function assertHubNotFinished(f: Awaited<ReturnType<typeof setup>>) {
  assert.equal(workoutFlow(f.workout()).stage, 'review', 'on the session hub');
  assert.equal(f.workout().status, 'active', 'still open');
  assert.equal(f.workout().completedAt, null);
  assert.equal(f.workout().pending.length, 0, 'nothing queued for upload');
  assert.equal(f.sent.length, 0, 'nothing uploaded');
  assert.throws(() => workoutCalendarEvent(f.workout()), /Finish the workout/, 'no calendar event');
}

// The screen's skip confirmation is what turned a skip into a finish (#4070).
test('#4070: confirming Skip on the last exercise never calls finish', async () => {
  const screen = await readFile(
    new URL('../src/features/workouts/screens/GuidedWorkoutScreen.tsx', import.meta.url),
    'utf8',
  );
  const branch = screen.match(/decision === 'skip'\) \{([\s\S]*?)\n    \} else/)?.[1];
  assert.ok(branch, 'the skip branch of confirm() is found');
  assert.match(branch, /skipExercise\(/);
  assert.doesNotMatch(branch, /finish\(/);
});

test('#4070: Skip from the set stage of the last exercise lands on the hub', async (t) => {
  const f = await setup(t);
  await f.completeAndAdvance(exerciseId);
  await f.start(secondId, 0);
  assert.ok(f.workout().runningSet);
  assert.equal(await f.controller.skipExercise(f.id), true);
  assertHubNotFinished(f);
  assert.equal(f.workout().runningSet, null);
});

test('#4070: Skip from the rest stage of the last exercise lands on the hub', async (t) => {
  const f = await setup(t);
  await f.completeAndAdvance(exerciseId);
  await f.record(secondId, 0);
  assert.ok(f.workout().rest, 'resting between sets');
  await f.controller.skipExercise(f.id);
  assertHubNotFinished(f);
  assert.equal(f.workout().rest, null);
});

test('#4070: Skip from the preparation stage of the last exercise lands on the hub', async (t) => {
  const f = await setup(t);
  await f.completeAndAdvance(exerciseId);
  assert.deepEqual(workoutFlow(f.workout()), { stage: 'exercise', exerciseId: secondId });
  await f.controller.skipExercise(f.id);
  assertHubNotFinished(f);
});

test('#4070: Skip when every exercise after it is already skipped lands on the hub', async (t) => {
  const f = await setup(t, 3);
  await f.completeAndAdvance(exerciseId);
  await f.controller.skipExercise(f.id); // the second, with the third still to come
  assert.deepEqual(workoutFlow(f.workout()), { stage: 'exercise', exerciseId: thirdId });
  await f.record(thirdId, 0);
  await f.controller.skipExercise(f.id);
  assertHubNotFinished(f);
  assert.equal(f.workout().exercises[1].skipped, true);
  assert.equal(f.workout().exercises[2].skipped, true);
});

test('#4070: the sets recorded before the skip stay on the phone', async (t) => {
  const f = await setup(t);
  await f.record(exerciseId, 0);
  await f.controller.skipExercise(f.id);
  await f.controller.chooseExercise(f.id, exerciseId);
  assert.equal(f.workout().exercises[0].sets.filter((set) => set.completedAt !== null).length, 1);
});

test('#4070: Next after the last exercise leaves the workout open on the hub', async (t) => {
  const f = await setup(t);
  await f.completeAndAdvance(exerciseId);
  for (let i = 0; i < f.workout().exercises[1].sets.length; i++) await f.record(secondId, i);
  assert.equal(workoutFlow(f.workout()).stage, 'summary');
  // The picture-in-picture window's Complete / Next button is `advance`.
  assert.deepEqual(pipCommand(f.workout(), 'log'), { type: 'advance' });
  await f.controller.advanceExercise(f.id);
  assertHubNotFinished(f);
});

test('#4070: the summary header button on the last exercise returns to the hub, not finish', () => {
  assert.equal(workoutBack('summary', false, 'header', true), 'session');
  assert.equal(workoutBack('summary', false, 'system', true), 'session');
  // A summary that is not the last one still continues.
  assert.equal(workoutBack('summary', false, 'header', false), 'next');
  assert.equal(workoutBack('summary', false, 'header'), 'next');
});

test('#4070: a deliberate Finish from the hub still uploads and can be put on the calendar', async (t) => {
  const f = await setup(t);
  await f.completeAndAdvance(exerciseId);
  await f.record(secondId, 0);
  await f.controller.skipExercise(f.id);
  assertHubNotFinished(f);
  const saved = await f.controller.finish(f.id);
  assert.equal(saved, true, String(f.controller.getSnapshot().message));
  assert.equal(f.workout().status, 'completed');
  await f.controller.sync();
  assert.ok(f.sent.length > 0, 'uploaded');
  assert.equal(workoutCalendarEvent(f.workout()).title.includes('TrainingAi'), true);
});
