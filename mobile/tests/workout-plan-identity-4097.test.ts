import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { buildCatalog, readSavedCatalog } from '../src/features/workouts/catalog.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { mutationFor, readJournal } from '../src/features/workouts/logging/workout.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';
import { workoutFixture } from './workout-fixture.ts';

// #4097: the plan the workout was trained on travels with the finish, so the server can tell it from
// a plan made after Start. Preview sends nothing else while the workout is trained.

const PLAN = '2026-10-20T05:00:00.123Z';

async function finishedWith(t: { after(fn: () => void): void }, planGeneratedAt: string | null | undefined) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = Date.UTC(2026, 9, 20, 8);
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
  await controller.initialize();
  await controller.sync();
  if (planGeneratedAt !== undefined) f.session.planGeneratedAt = planGeneratedAt;
  const id = (await controller.start(f.session, programId, true))!;
  await controller.beginExercises(id);
  const [first] = controller.getSnapshot().data.workouts[0].exercises[0].sets;
  await controller.startSet(id, exerciseId, first.id);
  now += 30_000;
  await controller.recordSet(id, exerciseId, first.id);
  await controller.finish(id);
  const done = controller.getSnapshot().data.workouts[0];
  const complete = mutationFor(done, done.pending.find((x) => x.domain === 'complete_workout')!);
  return { done, complete: complete.payload as Record<string, unknown>, controller, f };
}

test('the finish carries the identity of the plan the workout was started on (#4097)', async (t) => {
  const { done, complete } = await finishedWith(t, PLAN);
  assert.equal(done.planGeneratedAt, PLAN);
  assert.equal(complete.planGeneratedAt, PLAN);
  assert.equal(complete.workoutSessionId, done.id);
});

test('a session with no AI plan driving it sends no identity, as an older build did (#4097)', async (t) => {
  for (const value of [null, undefined]) {
    const { done, complete } = await finishedWith(t, value);
    assert.equal(done.planGeneratedAt, null);
    assert.equal('planGeneratedAt' in complete, false);
  }
});

test('a journal saved before the field existed still reads, and finishes without an identity (#4097)', async (t) => {
  const { controller, f } = await finishedWith(t, PLAN);
  const saved = JSON.parse(JSON.stringify(controller.getSnapshot().data));
  delete saved.workouts[0].planGeneratedAt;
  const read = readJournal(JSON.stringify(saved), f.connection);
  assert.equal(read.workouts[0].planGeneratedAt, null);
  const complete = mutationFor(read.workouts[0], read.workouts[0].pending.find((x) => x.domain === 'complete_workout')!);
  assert.equal('planGeneratedAt' in (complete.payload as object), false);
});

test('the catalogue keeps the plan identity the server serves, and drops anything malformed (#4097)', () => {
  const f = workoutFixture();
  const response = f.all.perSession['session-one'] as Record<string, unknown>;
  const sessionOf = (value: unknown) => {
    if (value === undefined) delete response.prescriptionGeneratedAt;
    else response.prescriptionGeneratedAt = value;
    return buildCatalog(f.meta, f.next, f.all, f.reader, 123).program!.sessions[0];
  };
  assert.equal(sessionOf(PLAN).planGeneratedAt, PLAN);
  assert.equal(sessionOf(undefined).planGeneratedAt, null, 'a server that does not send it');
  assert.equal(sessionOf('last Tuesday').planGeneratedAt, null);
  assert.equal(sessionOf(12345).planGeneratedAt, null);
  // It survives the saved catalogue, and a catalogue saved without it reads as having none.
  const catalog = buildCatalog(f.meta, f.next, { perSession: { 'session-one': { ...response, prescriptionGeneratedAt: PLAN } } }, f.reader, 123);
  assert.equal(readSavedCatalog(JSON.stringify(catalog), f.reader)!.program!.sessions[0].planGeneratedAt, PLAN);
  const older = JSON.parse(JSON.stringify(catalog));
  delete older.program.sessions[0].planGeneratedAt;
  assert.equal(readSavedCatalog(JSON.stringify(older), f.reader)!.program!.sessions[0].planGeneratedAt, null);
});
