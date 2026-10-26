import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import {
  activeElapsedMs,
  mutationFor,
  pauseWorkout,
  readJournal,
  resumeWorkout,
} from '../src/features/workouts/logging/workout.ts';
import { planAlerts } from '../src/features/platform/data/alert-plan.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';
import { pipCommand, pipPhaseFor } from '../src/features/workouts/pip/pip.ts';
import { workoutStatusFor } from '../src/features/workouts/status/workout-status.ts';
import { runPipAction } from '../src/features/workouts/pip/usePictureInPicture.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const MIN = 60_000;

async function setup(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = Date.UTC(2026, 9, 20, 8);
  const open = async () => {
    const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
    await controller.initialize();
    return controller;
  };
  const controller = await open();
  await controller.sync();
  const workout = () => controller.getSnapshot().data.workouts[0];
  return { ...f, scope, controller, open, workout, now: () => now, clock: (ms = 0) => (now += ms) };
}

// A workout in its first exercise, with its first set recorded and the rest running.
async function resting(f: Awaited<ReturnType<typeof setup>>) {
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const [first] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  return id;
}

test('a workout cannot be paused in its warm-up or its review (#3255)', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  assert.equal(await f.controller.pause(id), false, 'warm-up');
  assert.equal(f.workout().pausedAt, null);
  assert.throws(() => pauseWorkout(f.workout(), f.now()), /during its exercises/);
  const review = { ...f.workout(), flow: { stage: 'review' as const, exerciseId } };
  assert.throws(() => pauseWorkout(review, f.now()), /during its exercises/);
});

test('every clock stands still under a pause and picks up where it stopped (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const before = f.workout();
  const startedAt = before.rest!.startedAt;
  const endsAt = before.rest!.endsAt;
  const elapsedAtPause = f.clock(30_000);
  await f.controller.pause(id);
  const paused = f.workout();
  assert.equal(paused.pausedAt, elapsedAtPause);
  const frozen = activeElapsedMs(paused, elapsedAtPause);
  assert.equal(activeElapsedMs(paused, elapsedAtPause + 10 * MIN), frozen, 'the total holds');

  f.clock(10 * MIN);
  await f.controller.resume(id);
  const resumed = f.workout();
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.pausedMs, 10 * MIN);
  assert.equal(resumed.rest!.startedAt, startedAt + 10 * MIN, 'the rest began later by the pause');
  assert.equal(resumed.rest!.endsAt, endsAt + 10 * MIN, 'and ends later by it');
  assert.equal(resumed.restAnchor!.startedAt, before.restAnchor!.startedAt + 10 * MIN);
  assert.equal(activeElapsedMs(resumed, f.now()), frozen, 'the total resumes from where it stopped');
});

test('a running set loses the pause from its time (#3255)', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const [first] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(15_000);
  await f.controller.pause(id);
  f.clock(5 * MIN);
  await f.controller.resume(id);
  f.clock(5_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  const set = f.workout().exercises[0].sets[0];
  assert.equal((set.completedAt! - set.startedAt!) / 1000, 20, '15 s before the pause and 5 s after');
});

test('a pause survives a kill, and a second process still sees it (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  f.clock(5_000);
  await f.controller.pause(id);
  const reopened = await f.open();
  assert.equal(reopened.getSnapshot().data.workouts[0].pausedAt, f.now());
  f.clock(3 * MIN);
  await reopened.resume(id);
  assert.equal(reopened.getSnapshot().data.workouts[0].pausedMs, 3 * MIN);
});

test('nothing is logged, started or skipped under a pause (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  await f.controller.pause(id);
  const [, second] = f.workout().exercises[0].sets;
  const state = JSON.stringify(f.workout());
  assert.equal(await f.controller.startSet(id, exerciseId, second.id), false);
  assert.equal(await f.controller.skipRest(id), false);
  assert.equal(await f.controller.adjustRest(id, 30), false);
  assert.equal(await f.controller.advanceExercise(id), false);
  assert.equal(await f.controller.showSession(id), false);
  assert.match(f.controller.getSnapshot().message ?? '', /paused/);
  assert.equal(JSON.stringify(f.workout()), state, 'the journal is untouched');
  assert.equal(await f.controller.pause(id), false, 'a second pause is refused');
});

test('resume is refused when there is no pause (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  assert.equal(await f.controller.resume(id), false);
  assert.throws(() => resumeWorkout(f.workout(), f.now()), /not paused/);
});

test('finishing from a pause ends it, and the pause is not in the duration (#3255)', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const [first] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  const startedAt = f.workout().startedAt;
  await f.controller.pause(id);
  f.clock(8 * MIN);
  assert.equal(await f.controller.finish(id), true);
  const done = f.workout();
  assert.equal(done.status, 'completed');
  assert.equal(done.pausedAt, null);
  assert.equal(done.pausedMs, 8 * MIN);
  assert.equal(activeElapsedMs(done, done.completedAt!), done.completedAt! - startedAt - 8 * MIN);
  const upload = mutationFor(done, done.pending.find((x) => x.domain === 'complete_workout')!);
  assert.equal((upload.payload as { pausedSec: number }).pausedSec, 480);
});

test('a workout that was never paused uploads exactly what it did before (#3255)', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const [first] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  await f.controller.finish(id);
  const done = f.workout();
  const upload = mutationFor(done, done.pending.find((x) => x.domain === 'complete_workout')!);
  assert.deepEqual(Object.keys(upload.payload as object).sort(), ['completedAtMs', 'workoutSessionId']);
});

test('a journal saved before pause existed reads as never paused (#3255)', async (t) => {
  const f = await setup(t);
  await resting(f);
  const saved = JSON.parse(JSON.stringify(f.controller.getSnapshot().data));
  for (const workout of saved.workouts) {
    delete workout.pausedAt;
    delete workout.pausedMs;
  }
  const journal = readJournal(JSON.stringify(saved), { origin: f.connection.origin, userId: f.connection.userId });
  assert.equal(journal.workouts[0].pausedAt, null);
  assert.equal(journal.workouts[0].pausedMs, 0);
});

test('the rest cue and its alarm are off while paused, and back after Resume (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const settings = platformSchema.parse({ scope: 'account-one', restAlerts: true, walkCues: false });
  const plan = () => planAlerts(settings, f.controller.getSnapshot().data.workouts, null, f.now(), false);
  assert.equal(plan().filter((x) => x.id.includes(':rest:')).length, 1);
  await f.controller.pause(id);
  assert.equal(plan().filter((x) => x.id.includes(':rest:')).length, 0);
  f.clock(2 * MIN);
  await f.controller.resume(id);
  const [alert] = plan().filter((x) => x.id.includes(':rest:'));
  assert.equal((alert.trigger as { at: number }).at, f.workout().rest!.endsAt);
});

test('the status and the window both say paused, holding what was on screen (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const running = f.workout();
  assert.equal(workoutStatusFor(running)?.phase, 'resting');
  f.clock(10_000);
  await f.controller.pause(id);
  const paused = f.workout();
  const status = workoutStatusFor(paused)!;
  assert.equal(status.phase, 'paused');
  assert.equal(status.pausedAt, paused.pausedAt);
  assert.equal(status.exerciseName, running.exercises[0].name);
  assert.equal(status.restEndsAt, paused.rest!.endsAt, 'what is left of the rest is still in it');
  assert.equal(pipPhaseFor(paused), 'paused');
});

test('under a pause the window answers to Resume alone (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const running = f.workout();
  assert.deepEqual(pipCommand(running, 'restPlus'), { type: 'restPlus' });
  assert.deepEqual(pipCommand(running, 'pause'), { type: 'pause' });
  assert.equal(pipCommand(running, 'resume'), null, 'nothing to resume');
  await f.controller.pause(id);
  const paused = f.workout();
  for (const action of ['log', 'repsUp', 'repsDown', 'restPlus', 'pause'] as const)
    assert.equal(pipCommand(paused, action), null, action);
  assert.deepEqual(pipCommand(paused, 'resume'), { type: 'resume' });
});

test('+30 s needs a timed rest, and Pause is for a set or a rest only (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const untimed = { ...f.workout(), rest: null };
  assert.equal(pipCommand(untimed, 'restPlus'), null);
  assert.deepEqual(pipCommand(untimed, 'pause'), { type: 'pause' });
  const summary = { ...f.workout(), flow: { stage: 'summary' as const, exerciseId } };
  assert.equal(pipCommand(summary, 'pause'), null, 'between exercises the button is Next');
  void id;
});

test('window buttons pause, resume and add 30 s through the journal (#3255)', async (t) => {
  const f = await setup(t);
  const id = await resting(f);
  const before = f.workout().rest!.endsAt;
  runPipAction(f.workout(), f.controller, 'restPlus');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.workout().rest!.endsAt, before + 30_000);
  runPipAction(f.workout(), f.controller, 'pause');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.notEqual(f.workout().pausedAt, null);
  runPipAction(f.workout(), f.controller, 'resume');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.workout().pausedAt, null);
  void id;
});
