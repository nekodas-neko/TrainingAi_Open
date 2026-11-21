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
import {
  EFFORT_PIP_MS,
  effortQuestionWindow,
  unseenEffortQuestions,
} from '../src/features/workouts/logging/effort.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import { pipCommand } from '../src/features/workouts/pip/pip.ts';
import {
  createPipReporter,
  runPipAction,
} from '../src/features/workouts/pip/usePictureInPicture.ts';
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
  // The default counts once the card is on screen (GuidedWorkoutScreen marks it).
  assert.equal(uploaded(f.workout(), f.clock()).effort, undefined, 'never on screen: nothing');
  await f.controller.showEffort(f.id, unseenEffortQuestions(f.workout()));
  assert.equal(f.exercise().effortShown, true);
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

// A superset: A (Bench press, 3 sets) and B (Seated row, 2 sets) alternate, so B finishes first
// and A's last set opens the rest card that asks about both.
async function superset(t: { after(fn: () => void): void }) {
  const f = await setup(t);
  const partnerId = '10000000-0000-4000-8000-000000000044';
  const session = {
    ...f.session,
    exercises: [
      { ...f.session.exercises[0], supersetGroup: 7, setCount: 3 },
      { ...f.session.exercises[0], id: partnerId, name: 'Seated row', supersetGroup: 7, setCount: 2 },
    ],
  };
  await f.controller.discard(f.id);
  const id = (await f.controller.start(session, programId, true))!;
  await f.controller.beginExercises(id);
  const workout = () => f.controller.getSnapshot().data.workouts.find((w) => w.id === id)!;
  const of = (exercise: string) => workout().exercises.find((x) => x.id === exercise)!;
  for (let i = 0; i < 5; i++) {
    const flow = workoutFlow(workout());
    const set = of(flow.exerciseId).sets.find((x) => x.completedAt === null)!;
    await f.controller.startSet(id, flow.exerciseId, set.id);
    f.clock(30_000);
    assert.equal(await f.controller.recordSet(id, flow.exerciseId, set.id), true);
  }
  assert.deepEqual(workoutFlow(workout()), { stage: 'summary', exerciseId });
  const answer = (exercise: string) => [of(exercise).effortVsPlan, of(exercise).effortSource];
  const upload = (exercise: string) => {
    const done = finishWorkout(workout(), f.clock());
    const item = done.pending.find((x) => x.exerciseId === exercise)!;
    return LogExercisePayloadSchema.parse(mutationFor(done, item).payload).effort;
  };
  return { ...f, id, workout, partnerId, answer, upload };
}

test('a superset whose rest card was on screen keeps both defaults', async (t) => {
  const f = await superset(t);
  assert.deepEqual(unseenEffortQuestions(f.workout()).sort(), [exerciseId, f.partnerId].sort());
  await f.controller.showEffort(f.id, unseenEffortQuestions(f.workout()));
  assert.deepEqual(unseenEffortQuestions(f.workout()), []);
  assert.equal(await f.controller.advanceExercise(f.id), true);
  assert.deepEqual(f.answer(exerciseId), [0, 'default']);
  assert.deepEqual(f.answer(f.partnerId), [0, 'default']);
  assert.deepEqual(f.upload(f.partnerId), { vsPlan: 0, source: 'default' });
});

/** The app in the window: the reporter tells the window, and marks what the window asks. */
function inWindow(f: Awaited<ReturnType<typeof superset>>, now: () => number) {
  const reporter = createPipReporter({ setPhase: () => {} }, now, null, (asked) =>
    void f.controller.showEffort(f.id, [asked]),
  );
  reporter.update(f.workout());
  return reporter;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('a superset finished in the window: the partner never asked stores nothing', async (t) => {
  const f = await superset(t);
  const restStart = f.workout().rest!.startedAt;
  inWindow(f, () => restStart + 1_000);
  await settle();
  // The window asks about the exercise whose last set opened the card, and only that one.
  assert.equal(f.workout().exercises.find((x) => x.id === exerciseId)!.effortShown, true);
  assert.equal(f.workout().exercises.find((x) => x.id === f.partnerId)!.effortShown, false);
  // No tap; Next in the window once the 20 s are up.
  runPipAction(f.workout(), f.controller, 'log', restStart + EFFORT_PIP_MS + 1);
  await settle();
  // Next lands on the partner's own card, still in the window, and Next again leaves it.
  assert.deepEqual(workoutFlow(f.workout()), { stage: 'summary', exerciseId: f.partnerId });
  assert.equal(f.upload(f.partnerId), undefined, 'not on screen there either');
  runPipAction(f.workout(), f.controller, 'log', restStart + EFFORT_PIP_MS + 2);
  await settle();
  assert.equal(f.workout().flow?.stage, 'review');
  assert.deepEqual(f.answer(exerciseId), [0, 'default']);
  assert.deepEqual(f.answer(f.partnerId), [null, null]);
  assert.equal(f.upload(f.partnerId), undefined);
  assert.deepEqual(f.upload(exerciseId), { vsPlan: 0, source: 'default' });
});

test('a superset answered in the window: the tap is for that exercise alone', async (t) => {
  const f = await superset(t);
  const restStart = f.workout().rest!.startedAt;
  inWindow(f, () => restStart + 1_000);
  await settle();
  runPipAction(f.workout(), f.controller, 'effortHarder', restStart + 2_000);
  await settle();
  runPipAction(f.workout(), f.controller, 'log', restStart + 3_000);
  await settle();
  // On the partner's card, back in the app: it asks about the partner, which keeps its default.
  assert.deepEqual(workoutFlow(f.workout()), { stage: 'summary', exerciseId: f.partnerId });
  assert.deepEqual(f.answer(f.partnerId), [0, 'default']);
  assert.deepEqual(unseenEffortQuestions(f.workout()), [f.partnerId]);
  await f.controller.showEffort(f.id, unseenEffortQuestions(f.workout()));
  assert.equal(await f.controller.advanceExercise(f.id), true);
  assert.deepEqual(f.answer(exerciseId), [1, 'tapped']);
  assert.deepEqual(f.answer(f.partnerId), [0, 'default']);
});

test('a superset left from the window and finished there uploads no unseen default', async (t) => {
  const f = await superset(t);
  // Finishing straight from the rest card, with nothing on screen.
  assert.equal(f.upload(f.partnerId), undefined);
  assert.equal(f.upload(exerciseId), undefined);
  // Back on screen before finishing: the card asked about both.
  await f.controller.showEffort(f.id, unseenEffortQuestions(f.workout()));
  assert.deepEqual(f.upload(f.partnerId), { vsPlan: 0, source: 'default' });
});
