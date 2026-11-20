// #3745: "how did this exercise feel?" once per exercise, on the rest card after its last set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import {
  finishStaleWorkout,
  finishWorkout,
  mutationFor,
  readJournal,
  type WorkoutRecord,
} from '../src/features/workouts/logging/workout.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { EFFORT_PIP_MS, effortQuestionWindow } from '../src/features/workouts/logging/effort.ts';
import { pipCommand } from '../src/features/workouts/pip/pip.ts';
import { runPipAction } from '../src/features/workouts/pip/usePictureInPicture.ts';
import { LogExercisePayloadSchema } from '@trainingai/shared/workout/log-payload';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

async function setup(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = Date.now();
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
  await controller.initialize();
  await controller.sync();
  const id = (await controller.start(f.session, programId))!;
  assert.ok(id);
  await controller.beginExercises(id);
  const workout = () => controller.getSnapshot().data.workouts.find((w) => w.id === id)!;
  const exercise = () => workout().exercises.find((x) => x.id === exerciseId)!;
  return {
    ...f,
    id,
    scope,
    controller,
    workout,
    exercise,
    clock: (advance = 0) => (now += advance),
    /** Logs the next `count` sets of the exercise. */
    async log(count: number) {
      for (let i = 0; i < count; i++) {
        const set = exercise().sets.find((x) => x.completedAt === null)!;
        await controller.startSet(id, exerciseId, set.id);
        now += 30_000;
        assert.equal(await controller.recordSet(id, exerciseId, set.id), true);
        now += 60_000;
      }
    },
  };
}
const uploaded = (workout: WorkoutRecord, now: number) => {
  const done = finishWorkout(workout, now);
  const item = done.pending.find((x) => x.exerciseId === exerciseId)!;
  return LogExercisePayloadSchema.parse(mutationFor(done, item).payload);
};

test('the rest card after the last set starts on As expected, stored as the default', async (t) => {
  const f = await setup(t);
  const sets = f.exercise().sets.length;
  assert.ok(sets >= 2, 'the fixture has more than one set');
  await f.log(sets - 1);
  assert.equal(f.exercise().effortVsPlan, null, 'not asked before the last set');
  await f.log(1);
  assert.equal(f.workout().flow?.stage, 'summary');
  assert.deepEqual([f.exercise().effortVsPlan, f.exercise().effortSource], [0, 'default']);
  assert.deepEqual(uploaded(f.workout(), f.clock()).effort, { vsPlan: 0, source: 'default' });
});

test('a tap stores the answer as tapped, on the phone first, and uploads it', async (t) => {
  const f = await setup(t);
  await f.log(f.exercise().sets.length);
  assert.equal(await f.controller.answerEffort(f.id, exerciseId, 1), true);
  assert.deepEqual([f.exercise().effortVsPlan, f.exercise().effortSource], [1, 'tapped']);
  // Saved to the on-device journal before anything is sent.
  const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  const kept = saved.workouts[0].exercises.find((x) => x.id === exerciseId)!;
  assert.deepEqual([kept.effortVsPlan, kept.effortSource], [1, 'tapped']);
  // Tapping the starting answer is still the lifter's own.
  await f.controller.answerEffort(f.id, exerciseId, 0);
  assert.deepEqual(uploaded(f.workout(), f.clock()).effort, { vsPlan: 0, source: 'tapped' });
});

test('an exercise left before its last set uploads no answer, never a default', async (t) => {
  const f = await setup(t);
  await f.log(1);
  assert.equal(await f.controller.answerEffort(f.id, exerciseId, -1), false, 'refused mid-exercise');
  assert.equal(f.exercise().effortVsPlan, null);
  assert.equal(uploaded(f.workout(), f.clock()).effort, undefined);
});

test('a workout abandoned on the rest card keeps no default; a tap survives the stale save', async (t) => {
  const f = await setup(t);
  await f.log(f.exercise().sets.length);
  const open = f.workout();
  const saved = finishStaleWorkout(open);
  const item = saved.pending.find((x) => x.exerciseId === exerciseId)!;
  assert.equal(mutationFor(saved, item).payload.effort, undefined);
  await f.controller.answerEffort(f.id, exerciseId, -1);
  const tapped = finishStaleWorkout(f.workout());
  const again = tapped.pending.find((x) => x.exerciseId === exerciseId)!;
  assert.deepEqual(mutationFor(tapped, again).payload.effort, { vsPlan: -1, source: 'tapped' });
});

test('the per-set effort is untouched by the answer', async (t) => {
  const f = await setup(t);
  await f.log(f.exercise().sets.length);
  const before = f.exercise().sets.map((x) => [x.rpe, x.rpeSource]);
  await f.controller.answerEffort(f.id, exerciseId, 1);
  assert.deepEqual(f.exercise().sets.map((x) => [x.rpe, x.rpeSource]), before);
  const payload = uploaded(f.workout(), f.clock());
  assert.ok(payload.rpeSources?.every((x) => x === 'expected'));
});

test('the window asks for the first seconds of the rest, and a tap there is the same answer', async (t) => {
  const f = await setup(t);
  await f.log(f.exercise().sets.length);
  const restStart = f.workout().rest!.startedAt;
  const asked = effortQuestionWindow(f.workout(), restStart + 1_000);
  assert.deepEqual(asked, { exerciseId, until: restStart + EFFORT_PIP_MS, answer: 0 });
  assert.equal(effortQuestionWindow(f.workout(), restStart + EFFORT_PIP_MS), null, 'then the usual buttons');
  assert.equal(pipCommand(f.workout(), 'effortHarder', restStart + EFFORT_PIP_MS), null, 'a late tap does nothing');
  assert.deepEqual(pipCommand(f.workout(), 'effortHarder', restStart + 1_000), {
    type: 'effort',
    exerciseId,
    value: 1,
  });
  runPipAction(f.workout(), f.controller, 'effortEasier', restStart + 1_000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([f.exercise().effortVsPlan, f.exercise().effortSource], [-1, 'tapped']);
  assert.equal(effortQuestionWindow(f.workout(), restStart + 2_000), null, 'answered: the window stops asking');
});

test('a journal saved before this build reads, with no answer on any exercise', async (t) => {
  const f = await setup(t);
  await f.log(1);
  const raw = JSON.parse((await f.scope.get('workout-journal.v1'))!);
  for (const workout of raw.workouts) {
    for (const exercise of workout.exercises) {
      delete exercise.effortVsPlan;
      delete exercise.effortSource;
    }
  }
  const read = readJournal(JSON.stringify(raw), f.connection);
  assert.equal(read.workouts.length, 1);
  assert.ok(read.workouts[0].exercises.every((x) => x.effortVsPlan === null && x.effortSource === null));
});
