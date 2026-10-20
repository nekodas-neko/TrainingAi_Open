import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_REST_SEC, effectiveRestSec } from '@trainingai/shared/workout/rest-target';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import { finishWorkout, readJournal } from '../src/features/workouts/logging/workout.ts';
import { planAlerts } from '../src/features/platform/data/alert-plan.ts';
import { platformSchema } from '../src/features/platform/data/models.ts';
import { workoutActivity } from '../src/features/workouts/logging/activity-summary.ts';
import { pipPhaseFor, pipViewFor } from '../src/features/workouts/pip/pip.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

async function setup(t: { after(fn: () => void): void }, styleLess = false) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  if (styleLess) {
    // The last set's style sets no rest.
    f.response.exercises[0].progressionStyle[1] = {
      ...f.response.exercises[0].progressionStyle[1],
      restSec: 0,
    };
    const sets = f.session.exercises[0].sets;
    sets[sets.length - 1] = { ...sets[sets.length - 1], restSeconds: 0 };
  }
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = Date.UTC(2026, 9, 20, 8);
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
  await controller.initialize();
  await controller.sync();
  return {
    ...f,
    scope,
    controller,
    now: () => now,
    clock: (ms = 0) => (now += ms),
  };
}
// Starts a workout and records both sets of its exercise, ending on the exercise summary.
async function finishExercise(f: Awaited<ReturnType<typeof setup>>, adjust = 0) {
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const active = () => f.controller.getSnapshot().data.workouts[0];
  const [first, last] = active().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  if (adjust) {
    await f.controller.adjustRest(id, adjust);
  }
  f.clock(60_000);
  await f.controller.startSet(id, exerciseId, last.id);
  f.clock(25_000);
  await f.controller.recordSet(id, exerciseId, last.id);
  return { id, active, last };
}
const settings = (extra = {}) =>
  platformSchema.parse({
    scope: 'account-one',
    restAlerts: false,
    walkCues: false,
    ...extra,
  });

test('the rest target is the set’s own, or 90 s when its style sets none', () => {
  assert.equal(DEFAULT_REST_SEC, 90);
  assert.equal(effectiveRestSec(120), 120);
  assert.equal(effectiveRestSec(0), 90);
});

test('the last set starts its rest on the exercise summary, kept across a reopen', async (t) => {
  const f = await setup(t);
  const { active, last } = await finishExercise(f);
  const workout = active();
  assert.equal(workoutFlow(workout).stage, 'summary');
  assert.deepEqual(workout.rest, {
    exerciseId,
    setId: last.id,
    startedAt: f.now(),
    endsAt: f.now() + last.planned!.restSeconds * 1000,
    lastSet: true,
  });
  assert.ok(last.planned!.restSeconds > 0);
  assert.equal(workout.restAnchor, null);
  assert.equal(workout.exercises[0].sets[1].restAfterSec, 0);
  const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  assert.deepEqual(saved.workouts[0].rest, workout.rest);
});

test('a style with no rest gives the last set 90 s, and the rest adjustment still applies', async (t) => {
  const plain = await setup(t, true);
  const one = await finishExercise(plain);
  assert.equal(one.active().rest!.endsAt - one.active().rest!.startedAt, 90_000);
  const adjusted = await setup(t, true);
  const two = await finishExercise(adjusted, 30);
  assert.equal(two.active().rest!.endsAt - two.active().rest!.startedAt, 120_000);
});

test('the summary rest schedules the rest alarm at its end, in the foreground and background', async (t) => {
  const f = await setup(t);
  const { active } = await finishExercise(f);
  const workout = active();
  for (const foreground of [true, false]) {
    const [alert] = planAlerts(settings(), [workout], null, f.now(), foreground);
    assert.equal(alert?.title, 'Rest complete');
    // The current app's wording after an exercise's last set: N+1 (#3142).
    assert.equal(alert.body, 'Time for set 3');
    assert.deepEqual(alert.trigger, { at: workout.rest!.endsAt });
  }
  // With the rest cue off, only the background Alerts setting adds it, as for any rest.
  const quiet = { ...workout, timers: { ...workout.timers, restCues: false } };
  assert.deepEqual(planAlerts(settings(), [quiet], null, f.now(), false), []);
  assert.equal(planAlerts(settings({ restAlerts: true }), [quiet], null, f.now(), false).length, 1);
  // Once the rest is over, nothing is left to schedule; the summary shows overtime.
  assert.deepEqual(planAlerts(settings(), [workout], null, workout.rest!.endsAt + 1), []);
});

test('Next mid-rest ends the rest, cancels the alarm and records no rest against the set', async (t) => {
  const f = await setup(t);
  const { id, active } = await finishExercise(f);
  assert.equal(planAlerts(settings(), [active()], null, f.now()).length, 1);
  f.clock(30_000);
  await f.controller.advanceExercise(id);
  assert.equal(active().rest, null);
  assert.equal(active().restAnchor, null);
  assert.equal(active().exercises[0].sets[1].restAfterSec, 0);
  assert.deepEqual(planAlerts(settings(), [active()], null, f.now()), []);
  // Finishing from the summary clears it too.
  const other = await setup(t);
  const second = await finishExercise(other);
  const finished = finishWorkout(second.active(), other.now());
  assert.equal(finished.rest, null);
});

test('the status line outside the app leaves the summary rest out, as the current app’s rest chip does', async (t) => {
  const f = await setup(t);
  const { active } = await finishExercise(f);
  const summary = workoutActivity(active(), f.now());
  assert.notEqual(summary?.timer, 'Rest');
  assert.notEqual(summary?.timer, 'Overtime');
});

test('picture-in-picture shows the summary rest as a rest with every set done, then the placeholder', async (t) => {
  const f = await setup(t);
  const { id, active } = await finishExercise(f);
  const workout = active();
  assert.equal(pipPhaseFor(workout), 'summary');
  const view = pipViewFor(workout);
  assert.deepEqual(view, {
    kind: 'timer',
    exerciseName: workout.exercises[0].name,
    sets: 2,
    currentSet: 2,
    phase: 'rest',
    restTargetSec: (workout.rest!.endsAt - workout.rest!.startedAt) / 1000,
    restStartMs: workout.rest!.startedAt,
    setStartMs: null,
    load: null,
    setColor: null,
  });
  // A summary with no rest left to time keeps the current app's placeholder.
  assert.deepEqual(pipViewFor({ ...workout, rest: null }), {
    kind: 'placeholder',
    exerciseName: workout.exercises[0].name,
    hint: true,
  });
  await f.controller.advanceExercise(id);
  // Next leaves the summary (here for the end, the fixture's only exercise done) and the rest view
  // with it: the window keeps the session's placeholder, with no Next.
  assert.equal(pipPhaseFor(active()), 'done');
  assert.deepEqual(pipViewFor(active()), {
    kind: 'placeholder',
    exerciseName: active().sessionName,
    hint: false,
  });
});
