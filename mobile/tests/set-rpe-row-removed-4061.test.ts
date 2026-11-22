// #4061: the 6 to 10 RPE row is gone from the set card. A logged set carries what an untouched row
// always carried, the pre-filled expected value marked `expected`, so nothing that derives from set
// RPE moves for a lifter who never tapped the row. The golden payload below was captured from the
// code before the row was removed; this test fails if one byte of an untouched set's upload changes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { finishWorkout, mutationFor } from '../src/features/workouts/logging/workout.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { unseenEffortQuestions } from '../src/features/workouts/logging/effort.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const GOLDEN = new URL('./fixtures/untouched-set-payload-4061.json', import.meta.url);
const START = Date.UTC(2026, 10, 20, 2, 0, 0); // local midday in Brisbane, the fixture's zone

async function untouchedUpload(t: { after(fn: () => void): void }, answer?: 'shown' | 'harder') {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  let now = START;
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => now);
  await controller.initialize();
  await controller.sync();
  const id = (await controller.start(f.session, programId))!;
  await controller.beginExercises(id);
  const exercise = () =>
    controller.getSnapshot().data.workouts[0].exercises.find((x) => x.id === exerciseId)!;
  while (exercise().sets.some((x) => x.completedAt === null)) {
    const set = exercise().sets.find((x) => x.completedAt === null)!;
    await controller.startSet(id, exerciseId, set.id);
    now += 30_000;
    assert.equal(await controller.recordSet(id, exerciseId, set.id), true);
    now += 60_000;
  }
  if (answer === 'shown') await controller.showEffort(id, unseenEffortQuestions(controller.getSnapshot().data.workouts[0]));
  if (answer === 'harder') await controller.answerEffort(id, exerciseId, 1);
  const done = finishWorkout(controller.getSnapshot().data.workouts[0], now);
  const item = done.pending.find((x) => x.exerciseId === exerciseId)!;
  return { payload: mutationFor(done, item).payload, sets: exercise().sets.map((x) => ({ rpe: x.rpe, rpeSource: x.rpeSource })) };
}

test('an untouched set uploads exactly what it did before the row was removed', async (t) => {
  // As JSON, which is what goes over the wire.
  type Upload = Awaited<ReturnType<typeof untouchedUpload>>;
  const now = JSON.parse(JSON.stringify({
    untouched: await untouchedUpload(t),
    defaultShown: await untouchedUpload(t, 'shown'),
  })) as { untouched: Upload; defaultShown: Upload };
  if (!existsSync(GOLDEN)) writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
  assert.deepEqual(now, JSON.parse(readFileSync(GOLDEN, 'utf8')));
  // Every set carries the pre-filled expected value, never a rating.
  assert.ok(now.untouched.sets.every((x) => x.rpeSource === 'expected' && x.rpe != null));
  assert.deepEqual(now.untouched.payload.rpeSources, now.untouched.sets.map(() => 'expected'));
});

test('a tapped answer changes only the effort field, never the per-set RPE', async (t) => {
  const plain = await untouchedUpload(t, 'shown');
  const harder = await untouchedUpload(t, 'harder');
  assert.deepEqual(harder.payload.effort, { vsPlan: 1, source: 'tapped' });
  const { effort: _a, ...rest } = harder.payload as Record<string, unknown>;
  const { effort: _b, ...base } = plain.payload as Record<string, unknown>;
  assert.deepEqual(rest, base);
  assert.deepEqual(harder.sets, plain.sets);
});
