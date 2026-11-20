import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { finishWorkout, mutationFor } from '../src/features/workouts/logging/workout.ts';
import type { SessionStartOptions } from '../src/features/workouts/logging/session-options.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

// #3907(3): the session screen starts a workout with `fullOverride` when the lifter takes Full over a
// deload (`useSessionPreparation`). The workout records it as `wasOverride`, and every exercise log
// carries it, so the server keeps the session as a full one rather than the deload it was planned as.
async function logOne(t: { after(fn: () => void): void }, options: SessionStartOptions) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  let now = Date.UTC(2026, 10, 20, 2);
  const controller = new WorkoutJournalStore(
    storage.account(f.connection.origin, f.connection.userId), f.connection, f.uuid, () => now,
  );
  await controller.initialize();
  const id = (await controller.start(f.session, programId, true, options))!;
  await controller.beginExercises(id);
  const [first] = controller.getSnapshot().data.workouts[0].exercises[0].sets;
  await controller.startSet(id, exerciseId, first.id);
  now += 30_000;
  await controller.recordSet(id, exerciseId, first.id);
  const finished = finishWorkout(controller.getSnapshot().data.workouts[0], (now += 60_000));
  const log = finished.pending.find((item) => item.domain === 'workout_log')!;
  return mutationFor(finished, log).payload as { intensityMode?: string; wasOverride?: boolean };
}

test('Full over a deload: the log says full, and that it was overridden', async (t) => {
  const payload = await logOne(t, { aiDeload: false, fullOverride: true });
  assert.equal(payload.intensityMode, 'full');
  assert.equal(payload.wasOverride, true);
});

test('the deload taken: a deload, not overridden', async (t) => {
  const payload = await logOne(t, { aiDeload: true, fullOverride: false });
  assert.equal(payload.intensityMode, 'deload');
  assert.equal(payload.wasOverride, false);
});

test('an ordinary full session: not overridden', async (t) => {
  const payload = await logOne(t, {});
  assert.equal(payload.intensityMode, 'full');
  assert.equal(payload.wasOverride, false);
});
