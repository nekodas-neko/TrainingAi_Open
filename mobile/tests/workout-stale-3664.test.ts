import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import {
  STALE_WORKOUT_NOTICE,
  WorkoutJournalStore,
} from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import {
  finishStaleWorkout,
  isStaleWorkout,
  mutationFor,
  readJournal,
  STALE_WORKOUT_MS,
} from '../src/features/workouts/logging/workout.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

async function setup(t: { after(fn: () => void): void }) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = Date.UTC(2026, 9, 20, 8);
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
  await controller.initialize();
  await controller.sync();
  const workout = () => controller.getSnapshot().data.workouts[0];
  return { ...f, controller, workout, now: () => now, clock: (ms = 0) => (now += ms) };
}

// Yesterday's workout: one set recorded, the next one started, then left with its rest running.
async function abandoned(f: Awaited<ReturnType<typeof setup>>) {
  const id = (await f.controller.start(f.session, programId, true))!;
  await f.controller.beginExercises(id);
  const [first, second] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(30_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  const lastSetAt = f.now();
  f.clock(2 * MIN);
  await f.controller.startSet(id, exerciseId, second.id);
  return { id, lastSetAt };
}

test('a workout untouched for four hours is stale; one in progress is not (#3664)', async (t) => {
  const f = await setup(t);
  await abandoned(f);
  assert.equal(isStaleWorkout(f.workout(), f.now() + STALE_WORKOUT_MS), false, 'exactly four hours');
  assert.equal(isStaleWorkout(f.workout(), f.now() + STALE_WORKOUT_MS + 1), true);
  // A long session is measured from its last activity, not its start.
  f.clock(3 * HOUR);
  const id = f.workout().id;
  const [, second] = f.workout().exercises[0].sets;
  await f.controller.recordSet(id, exerciseId, second.id);
  assert.equal(isStaleWorkout(f.workout(), f.now() + 2 * HOUR), false);
});

test('a stale workout is not resumed by start (#3664)', async (t) => {
  const f = await setup(t);
  const { id } = await abandoned(f);
  assert.equal(await f.controller.start(f.session, programId, true), id, 'fresh: resumed');
  f.clock(20 * HOUR);
  assert.equal(await f.controller.start(f.session, programId, true), null);
  assert.equal(f.controller.getSnapshot().message, STALE_WORKOUT_NOTICE);
  assert.equal(f.workout().status, 'active', 'nothing was thrown away');
});

test('saving a stale workout ends it at its last set and uploads it under its own day (#3664)', async (t) => {
  const f = await setup(t);
  const { id, lastSetAt } = await abandoned(f);
  const date = f.workout().date;
  f.clock(20 * HOUR);
  assert.equal(await f.controller.finishStale(id), true);
  const done = f.workout();
  assert.equal(done.status, 'completed');
  assert.equal(done.completedAt, lastSetAt, 'not now, so the gap is not in its duration');
  assert.equal(done.date, date);
  assert.equal(done.runningSet, null);
  assert.equal(done.exercises[0].sets.filter((set) => set.completedAt !== null).length, 1);
  assert.equal(done.exercises[0].sets[1].startedAt, null, 'the set in progress is dropped');
  const log = mutationFor(done, done.pending.find((x) => x.domain === 'workout_log')!);
  assert.equal(log.date, date);
  assert.equal((log.payload as { localDate: string }).localDate, date);
  const complete = mutationFor(done, done.pending.find((x) => x.domain === 'complete_workout')!);
  assert.equal((complete.payload as { completedAtMs: number }).completedAtMs, lastSetAt);
  // The saved journal reads back.
  const raw = JSON.stringify(f.controller.getSnapshot().data);
  assert.equal(readJournal(raw, f.connection).workouts[0].completedAt, lastSetAt);
});

test('a stale workout with nothing recorded can only be discarded (#3664)', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  f.clock(5 * HOUR);
  assert.equal(isStaleWorkout(f.workout(), f.now()), true);
  assert.throws(() => finishStaleWorkout(f.workout()), /Discard it instead/);
  assert.equal(await f.controller.finishStale(id), false);
  assert.equal(await f.controller.discard(id), true);
  assert.equal(f.workout().status, 'discarded');
});

test('a workout still in progress cannot be closed as stale (#3664)', async (t) => {
  const f = await setup(t);
  const { id } = await abandoned(f);
  f.clock(30 * MIN);
  assert.equal(await f.controller.finishStale(id), false);
  assert.equal(f.workout().status, 'active');
});

test('a Preview log sends its progression style id, as the current app does (#3663)', async (t) => {
  const f = await setup(t);
  const styleId = '30000000-0000-4000-8000-000000000001';
  (f.response.exercises[0] as Record<string, unknown>).styleId = styleId;
  const id = (await f.controller.start(f.session, programId))!;
  await f.controller.beginExercises(id);
  const [first] = f.workout().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(30_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  await f.controller.finish(id);
  const done = f.workout();
  const log = mutationFor(done, done.pending.find((x) => x.domain === 'workout_log')!);
  assert.equal((log.payload as { styleId?: string }).styleId, styleId);
  // A journal saved before the field existed still reads, and sends no style id.
  const saved = JSON.parse(JSON.stringify(f.controller.getSnapshot().data));
  delete saved.workouts[0].exercises[0].styleId;
  const old = readJournal(JSON.stringify(saved), f.connection).workouts[0];
  const oldLog = mutationFor(old, old.pending.find((x) => x.domain === 'workout_log')!);
  assert.equal('styleId' in (oldLog.payload as object), false);
});
