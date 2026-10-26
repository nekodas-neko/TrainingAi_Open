import {
  defaultTimers,
  displayLoad,
  loadLabel,
  storedLoad,
} from '../src/features/workouts/logging/preferences.ts';
import { previousValueChanges } from '../src/features/workouts/logging/reuse.ts';
import { workoutTiming } from '../src/features/workouts/logging/timing.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  createWorkout,
  emptyJournal,
  finishWorkout,
  mutationFor,
  readJournal,
} from '../src/features/workouts/logging/workout.ts';
import {
  PROGRAM_AS_WRITTEN,
  WorkoutJournalStore,
} from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import {
  formatSetLoad,
  loadSuggestion,
  prescribedWeight,
  isAmrap,
} from '../src/features/workouts/logging/targets.ts';
import {
  exerciseResult,
  workoutResult,
} from '../src/features/workouts/logging/summary.ts';
import { LogExercisePayloadSchema } from '@trainingai/shared/workout/log-payload';
import { CompleteWorkoutPayloadSchema } from '@trainingai/shared/workout/complete-payload';
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
  return { ...f, storage, scope, controller, clock: (advance = 0) => (now += advance) };
}
async function recordFirst(f: Awaited<ReturnType<typeof setup>>) {
  const id = await f.controller.start(f.session, programId);
  assert.ok(id);
  const set = f.controller.getSnapshot().data.workouts[0].exercises[0].sets[0];
  f.controller.updateSet(id, exerciseId, set.id, 'weight', '60');
  await f.controller.startSet(id, exerciseId, set.id);
  f.clock(30_000);
  assert.equal(await f.controller.recordSet(id, exerciseId, set.id), true);
  return { id, setId: set.id };
}

test('start pins the live prescription; input, set timer and rest survive reopening SQLite', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  const active = f.controller.getSnapshot().data.workouts[0];
  assert.equal(active.id, id);
  assert.equal(active.exercises[0].sets[0].weight, '60');
  assert.equal(active.rest!.endsAt - active.rest!.startedAt, 90_000);
  f.controller.cancel();
  const restored = new WorkoutJournalStore(f.scope, f.connection, f.uuid, f.clock);
  await restored.initialize();
  await restored.sync();
  assert.deepEqual(restored.getSnapshot().data.workouts[0], active);
  assert.equal(await restored.start(f.session, programId), id);
  assert.equal(restored.getSnapshot().data.workouts.length, 1);
  assert.equal(f.requests.length, 0);
});

test('finishing offline atomically saves logs and completion; reconnect pushes in dependency order', async (t) => {
  const f = await setup(t);
  let offline = true;
  const domains: string[] = [];
  const identities: string[] = [];
  f.connection.post = async (_path, body) => {
    const mutation = (
      body as { mutations: { id: string; domain: string; payload: unknown }[] }
    ).mutations[0];
    identities.push(mutation.id);
    if (offline) {
      throw new Error('offline');
    }
    domains.push(mutation.domain);
    assert.equal(
      mutation.domain === 'workout_log'
        ? LogExercisePayloadSchema.safeParse(mutation.payload).success
        : CompleteWorkoutPayloadSchema.safeParse(mutation.payload).success,
      true,
    );
    return { processed: 1, errors: [] };
  };
  const { id } = await recordFirst(f);
  assert.equal(await f.controller.finish(id), true);
  await f.controller.sync();
  const completed = f.controller.getSnapshot().data.workouts[0];
  assert.equal(completed.status, 'completed');
  assert.equal(completed.pending.length, 2);
  assert.ok(completed.syncError);
  const payload = mutationFor(completed, completed.pending[0]);
  assert.deepEqual(payload.payload.weights, [60]);
  assert.deepEqual(payload.payload.setTimes, [30]);
  assert.deepEqual(payload.payload.progressionStyle, [
    { pct: 70, reps: 8, restSec: 90, useFor1rm: true },
  ]);
  assert.equal(payload.payload.editedAt, completed.completedAt);
  const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  assert.equal(saved.workouts[0].pending.length, 2);
  offline = false;
  f.controller.cancel();
  const restored = new WorkoutJournalStore(f.scope, f.connection, f.uuid, f.clock);
  await restored.initialize();
  await restored.sync();
  assert.deepEqual(domains, ['workout_log', 'complete_workout']);
  assert.equal(identities[0], identities[1]);
  assert.equal(restored.getSnapshot().data.workouts[0].pending.length, 0);
  assert.ok(restored.getSnapshot().data.workouts[0].syncedAt);
});

test('rest timestamps measure the actual rest and do not fabricate untimed set durations', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  f.clock(95_000);
  const second = f.controller.getSnapshot().data.workouts[0].exercises[0].sets[1];
  f.controller.updateSet(id, exerciseId, second.id, 'weight', '65');
  await f.controller.startSet(id, exerciseId, second.id);
  f.clock(25_000);
  await f.controller.recordSet(id, exerciseId, second.id);
  const finished = finishWorkout(f.controller.getSnapshot().data.workouts[0], f.clock());
  const payload = mutationFor(finished, finished.pending[0]).payload;
  assert.deepEqual(payload.restTimes, [95, 0]);
  assert.deepEqual(payload.setTimes, [30, 25]);
  const manual = createWorkout(f.session, programId, null, true, f.clock(), f.uuid);
  manual.exercises[0].sets[0] = {
    ...manual.exercises[0].sets[0],
    weight: '60',
    completedAt: f.clock(10_000),
  };
  const manualFinished = finishWorkout(manual, f.clock());
  const manualPayload = mutationFor(manualFinished, manualFinished.pending[0]).payload;
  assert.equal(manualPayload.setStartTimes, undefined);
  assert.equal(manualPayload.setTimes, undefined);
  assert.equal(manualPayload.restTimes, undefined);
  assert.ok(manualPayload.setEndTimes);
});

test('finish validation prevents empty workouts, incomplete running sets and invalid entered values', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId))!;
  assert.equal(await f.controller.finish(id), false);
  const set = f.controller.getSnapshot().data.workouts[0].exercises[0].sets[0];
  await f.controller.startSet(id, exerciseId, set.id);
  assert.equal(await f.controller.finish(id), false);
  f.controller.updateSet(id, exerciseId, set.id, 'weight', '');
  assert.equal(await f.controller.recordSet(id, exerciseId, set.id), false);
  assert.match(f.controller.getSnapshot().message!, /weight/);
  f.controller.updateSet(id, exerciseId, set.id, 'weight', '501');
  assert.equal(await f.controller.recordSet(id, exerciseId, set.id), false);
  f.controller.updateSet(id, exerciseId, set.id, 'weight', '60,5');
  f.clock(10_000);
  assert.equal(await f.controller.recordSet(id, exerciseId, set.id), true);
  f.controller.updateSet(id, exerciseId, set.id, 'reps', '1.5');
  assert.equal(await f.controller.finish(id), false);
  assert.equal(f.controller.getSnapshot().data.workouts[0].status, 'active');
});

test('prescribed loads, rated effort and accepted back-off survive reopening and preserve the original targets', async (t) => {
  const f = await setup(t);
  Object.assign(f.response.exercises[0], {
    estimated1rm: 95,
    equipment: ['barbell'],
    defaultSets: 8,
  });
  const id = (await f.controller.start(f.session, programId))!;
  let workout = f.controller.getSnapshot().data.workouts[0];
  const exercise = workout.exercises[0];
  assert.equal(exercise.sets.length, 2);
  assert.deepEqual(
    exercise.sets.map((set) => set.weight),
    ['67.5', '72.5'],
  );
  assert.deepEqual(
    exercise.sets.map((set) => set.plannedWeight),
    [67.5, 72.5],
  );
  assert.equal(
    prescribedWeight(
      { ...f.session.exercises[0], estimated1rm: 95, equipment: [] },
      f.session.exercises[0].sets[1],
    ),
    71.25,
  );
  const [first, second] = exercise.sets;
  f.controller.updateSet(id, exerciseId, first.id, 'weight', '55');
  f.controller.updateSet(id, exerciseId, first.id, 'reps', '6');
  assert.equal(await f.controller.rateSet(id, exerciseId, first.id, 11), false);
  assert.equal(await f.controller.rateSet(id, exerciseId, first.id, 10), true);
  await f.controller.recordSet(id, exerciseId, first.id);
  workout = f.controller.getSnapshot().data.workouts[0];
  const suggestion = loadSuggestion(
    workout,
    workout.exercises[0],
    workout.exercises[0].sets[1],
  );
  assert.ok(suggestion && suggestion.weightKg < 72.5);
  // The current app reads the session's deload choice, not one exercise's flag (#3008).
  const nextSet = workout.exercises[0].sets[1];
  assert.equal(
    loadSuggestion({ ...workout, intensityMode: 'deload' }, workout.exercises[0], nextSet),
    null,
  );
  assert.ok(
    loadSuggestion(workout, { ...workout.exercises[0], deloaded: true }, nextSet),
  );
  assert.equal(
    await f.controller.resolveSuggestion(id, exerciseId, second.id, true),
    true,
  );
  f.controller.cancel();
  const restored = new WorkoutJournalStore(f.scope, f.connection, f.uuid, f.clock);
  await restored.initialize();
  workout = restored.getSnapshot().data.workouts[0];
  assert.equal(workout.exercises[0].sets[0].rpeSource, 'rated');
  assert.equal(workout.exercises[0].sets[1].weight, String(suggestion.weightKg));
  assert.equal(
    loadSuggestion(workout, workout.exercises[0], workout.exercises[0].sets[1]),
    null,
  );
  await restored.recordSet(id, exerciseId, second.id);
  f.clock(15_000);
  const completed = finishWorkout(restored.getSnapshot().data.workouts[0], f.clock());
  const payload = mutationFor(completed, completed.pending[0]).payload;
  assert.deepEqual(payload.weights, [55, suggestion.weightKg]);
  assert.deepEqual(payload.plannedWeights, [67.5, 72.5]);
  assert.deepEqual(payload.rpeValues, [10, 6]);
  assert.deepEqual(payload.rpeSources, ['rated', 'expected']);
  assert.equal(completed.exercises[0].sets[1].restAfterSec, null);
});

test('bodyweight and baseline logging keep rep targets, signed load and effort semantics', async (t) => {
  const f = await setup(t);
  Object.assign(f.response.exercises[0], {
    exerciseType: 'bodyweight',
    lastSetMode: 'amrap',
  });
  const id = (await f.controller.start(f.session, programId))!;
  const exercise = f.controller.getSnapshot().data.workouts[0].exercises[0];
  const [first, second] = exercise.sets;
  assert.deepEqual(
    exercise.sets.map((set) => set.weight),
    ['0', '0'],
  );
  assert.equal(second.reps, '7');
  assert.equal(first.rpe, 7);
  assert.equal(isAmrap(f.controller.getSnapshot().data.workouts[0], exercise, 1), true);
  assert.equal(formatSetLoad(exercise, first), '8 reps');
  f.controller.updateSet(id, exerciseId, first.id, 'weight', '-15');
  await f.controller.rateSet(id, exerciseId, first.id, 8);
  await f.controller.recordSet(id, exerciseId, first.id);
  const workout = f.controller.getSnapshot().data.workouts[0];
  assert.equal(formatSetLoad(exercise, workout.exercises[0].sets[0]), '-15 kg × 8 reps');
  assert.equal(loadSuggestion(workout, workout.exercises[0], second), null);
  assert.equal(exerciseResult(workout, workout.exercises[0]).repMax, 8);
  assert.equal(exerciseResult(workout, workout.exercises[0]).ratedRpe, 8);
  const result = workoutResult(workout);
  assert.equal(result.timedSetSeconds, null);
  assert.equal(result.warmupSeconds, null);
  const completed = finishWorkout(workout, f.clock());
  const payload = mutationFor(completed, completed.pending[0]).payload;
  assert.deepEqual(payload.weights, [-15]);
  assert.equal(payload.plannedWeights, undefined);
  assert.equal(
    exerciseResult({ ...completed, isBaseline: true }, completed.exercises[0]).repMax,
    8,
  );
  assert.equal(
    exerciseResult(completed, { ...completed.exercises[0], deloaded: true }).estimate,
    null,
  );
});

test('older recorded sets keep unknown effort and target loads instead of gaining new defaults', () => {
  const f = loggingFixture();
  const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
  workout.exercises[0].sets[0].completedAt = workout.startedAt;
  const raw = JSON.parse(
    JSON.stringify({ ...emptyJournal(f.connection), workouts: [workout] }),
  );
  for (const set of raw.workouts[0].exercises[0].sets) {
    delete set.rpe;
    delete set.rpeSource;
    delete set.plannedWeight;
    delete set.suggestionHandled;
  }
  for (const field of [
    'equipment',
    'estimated1rm',
    'target80',
    'latestWeight',
    'lastSetMode',
  ]) {
    delete raw.workouts[0].exercises[0][field];
  }
  const restored = readJournal(JSON.stringify(raw), f.connection).workouts[0];
  assert.equal(restored.exercises[0].sets[0].rpe, null);
  assert.equal(restored.exercises[0].estimated1rm, null);
  const completed = finishWorkout(restored, restored.startedAt);
  const payload = mutationFor(completed, completed.pending[0]).payload;
  assert.equal(payload.rpeValues, undefined);
  assert.equal(payload.rpeSources, undefined);
  assert.equal(payload.plannedWeights, undefined);
  assert.equal(exerciseResult(completed, completed.exercises[0]).ratedRpe, null);
});

test('a failed finish write preserves the resumable workout and never uploads it', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  const scope = {
    ...f.scope,
    set: async (key: string, value: string) => {
      if (
        JSON.parse(value).workouts.some(
          (workout: { status: string }) => workout.status === 'completed',
        )
      ) {
        throw new Error('disk full');
      }
      await f.scope.set(key, value);
    },
  };
  f.controller.cancel();
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, f.clock);
  await controller.initialize();
  await controller.sync();
  assert.equal(await controller.finish(id), false);
  assert.equal(controller.getSnapshot().data.workouts[0].status, 'active');
  assert.equal(controller.getSnapshot().data.workouts[0].pending.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0].status,
    'active',
  );
});

test('per-item rejection, missing confirmation and authorization errors retain the dependent completion', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  let response: unknown = { processed: 0, errors: [] };
  f.connection.post = async () => response;
  await f.controller.finish(id);
  await f.controller.sync();
  for (response of [
    { processed: 1, errors: [{ domain: 'workout_log', error: 'rejected' }] },
    {},
    { processed: 0, errors: [] },
  ]) {
    await f.controller.sync();
    assert.equal(f.controller.getSnapshot().data.workouts[0].pending.length, 2);
  }
  f.connection.post = async () => {
    throw new ApiError(401);
  };
  await f.controller.sync();
  assert.equal(f.controller.getSnapshot().data.workouts[0].pending.length, 2);
  assert.match(f.controller.getSnapshot().data.workouts[0].syncError!, /Sign in/);
});

test('lost responses replay stable row IDs and simultaneous sync calls share one upload', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  f.connection.post = async () => {
    calls++;
    await gate;
    throw new Error('lost response');
  };
  await f.controller.finish(id);
  const first = f.controller.sync();
  assert.equal(f.controller.sync(), first);
  while (!calls) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  release();
  await first;
  assert.equal(calls, 1);
  const ids = f.controller.getSnapshot().data.workouts[0].pending.map((item) => item.id);
  assert.deepEqual(
    readJournal(
      await f.scope.get('workout-journal.v1'),
      f.connection,
    ).workouts[0].pending.map((item) => item.id),
    ids,
  );
});

test('account and backend partitions cannot show or push another account’s workout', async (t) => {
  const f = await setup(t);
  await recordFirst(f);
  for (const connection of [
    { ...f.connection, userId: 'user-two' },
    { ...f.connection, origin: 'https://other.example' },
  ]) {
    const controller = new WorkoutJournalStore(
      f.storage.account(connection.origin, connection.userId),
      connection,
      f.uuid,
    );
    await controller.initialize();
    await controller.sync();
    assert.equal(controller.getSnapshot().data.workouts.length, 0);
  }
  assert.equal(f.requests.length, 0);
});

test('corrupt saved workouts block writes and preserve the original data', async (t) => {
  const f = await setup(t);
  f.controller.cancel();
  await f.scope.set('workout-journal.v1', '{broken');
  const controller = new WorkoutJournalStore(f.scope, f.connection, f.uuid);
  await controller.initialize();
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(await controller.start(f.session, programId), null);
  await controller.retrySave();
  assert.equal(await f.scope.get('workout-journal.v1'), '{broken');
});

test('offline starts require an explicit saved plan; pending and unauthorized prescriptions cannot start', async (t) => {
  const f = await setup(t);
  f.connection.get = async () => {
    throw new Error('offline');
  };
  assert.equal(await f.controller.start(f.session, programId), null);
  assert.equal(f.controller.getSnapshot().savedFallbackFor, f.session.id);
  const id = await f.controller.start(f.session, programId, true);
  assert.ok(id);
  assert.equal(f.controller.getSnapshot().data.workouts[0].fromSavedPlan, true);
  await f.controller.discard(id);
  f.connection.get = async () => {
    throw new ApiError(403);
  };
  assert.equal(await f.controller.start(f.session, programId), null);
  assert.equal(f.controller.getSnapshot().savedFallbackFor, null);
  assert.equal(
    await f.controller.start(
      { ...f.session, prescriptionPending: true },
      programId,
      true,
    ),
    null,
  );
  assert.equal(
    f.controller
      .getSnapshot()
      .data.workouts.filter((workout) => workout.status === 'active').length,
    0,
  );
});

test('workout day is pinned to account timezone across midnight and an offline completion', () => {
  const f = loggingFixture();
  const at = new Date('2026-10-10T14:30:00Z').getTime();
  const brisbane = createWorkout(
    f.session,
    programId,
    'Australia/Brisbane',
    true,
    at,
    f.uuid,
  );
  const newYork = createWorkout(
    f.session,
    programId,
    'America/New_York',
    true,
    at,
    f.uuid,
  );
  assert.equal(brisbane.date, '2026-10-11');
  assert.equal(newYork.date, '2026-10-10');
  assert.equal(
    readJournal(
      JSON.stringify({ ...emptyJournal(f.connection), workouts: [brisbane] }),
      f.connection,
    ).workouts[0].date,
    '2026-10-11',
  );
});

test('a pending prescription is requested, then read back before the workout starts', async (t) => {
  const f = await setup(t);
  const queries: unknown[] = [];
  const posts: string[] = [];
  let pending = true;
  f.connection.get = async (_path, query) => {
    queries.push(query);
    return { ...f.response, aiPrescriptionPending: pending };
  };
  f.connection.post = async (path) => {
    posts.push(path);
    // The server stores the program as written when the model fails (RV-202).
    pending = false;
    return {};
  };
  assert.ok(await f.controller.start(f.session, programId));
  assert.deepEqual(posts, [`/api/ai-periodization/session/${f.session.id}/prescribe`]);
  assert.deepEqual(queries, [{ tab: f.session.id }, { tab: f.session.id, poll: '1' }]);
  assert.equal(f.controller.getSnapshot().message, null);
});

test('a prescription that cannot be made starts from the program as written', async (t) => {
  const f = await setup(t);
  f.connection.get = async () => ({ ...f.response, aiPrescriptionPending: true });
  f.connection.post = async () => {
    throw new ApiError(429);
  };
  const id = await f.controller.start(f.session, programId);
  assert.ok(id);
  assert.equal(f.controller.getSnapshot().message, PROGRAM_AS_WRITTEN);
  const workout = f.controller.getSnapshot().data.workouts.find((w) => w.id === id)!;
  assert.equal(workout.fromSavedPlan, false);
  assert.ok(workout.exercises.length > 0);
});

test('upload confirmation merges concurrent new-workout edits without losing local progress', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  f.connection.post = async () => {
    throw new Error('offline');
  };
  await f.controller.finish(id);
  await f.controller.sync();
  f.controller.cancel();
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let releaseWrite!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let uploading = false;
  let confirming = false;
  let first = true;
  f.connection.post = async () => {
    if (first) {
      first = false;
      uploading = true;
      await uploadGate;
    }
    return { processed: 1, errors: [] };
  };
  const scope = {
    ...f.scope,
    set: async (key: string, value: string) => {
      const data = JSON.parse(value);
      if (
        !confirming &&
        data.workouts.length === 2 &&
        data.workouts[0].pending.length === 1
      ) {
        confirming = true;
        await writeGate;
      }
      await f.scope.set(key, value);
    },
  };
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, f.clock);
  await controller.initialize();
  const syncing = controller.sync();
  while (!uploading) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const nextId = (await controller.start(f.session, programId))!;
  releaseUpload();
  while (!confirming) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const nextSet = controller.getSnapshot().data.workouts[1].exercises[0].sets[0];
  controller.updateSet(nextId, exerciseId, nextSet.id, 'weight', '75');
  releaseWrite();
  await syncing;
  await controller.retrySave();
  const restored = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  assert.equal(restored.workouts[0].pending.length, 0);
  assert.equal(restored.workouts[1].id, nextId);
  assert.equal(restored.workouts[1].exercises[0].sets[0].weight, '75');
});

test('sign-out during an upload leaves the saved queue intact and does not send completion', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  let release!: () => void;
  let uploading = false;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  f.connection.post = async () => {
    calls++;
    uploading = true;
    await waiting;
    return { processed: 1, errors: [] };
  };
  await f.controller.finish(id);
  const syncing = f.controller.sync();
  while (!uploading) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  f.controller.cancel();
  release();
  await syncing;
  assert.equal(calls, 1);
  assert.equal(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0].pending
      .length,
    2,
  );
});

test('corrupt upload ordering is rejected without dropping the recorded sets', async (t) => {
  const f = await setup(t);
  await recordFirst(f);
  const completed = finishWorkout(f.controller.getSnapshot().data.workouts[0], f.clock());
  completed.pending.reverse();
  const raw = JSON.stringify({ ...emptyJournal(f.connection), workouts: [completed] });
  assert.throws(() => readJournal(raw, f.connection), /upload order/);
});

test('guided warm-up, rest, summary and next exercise persist without uploading unfinished work', async (t) => {
  const f = await setup(t);
  const secondId = '10000000-0000-4000-8000-000000000004';
  const session = {
    ...f.session,
    exercises: [
      ...f.session.exercises,
      { ...f.session.exercises[0], id: secondId, name: 'Seated row' },
    ],
  };
  const id = (await f.controller.start(session, programId, true))!;
  const active = () => f.controller.getSnapshot().data.workouts[0];
  assert.equal(workoutFlow(active()).stage, 'warmup');
  await f.controller.showSession(id);
  assert.equal(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0]
      .hubReturnStage,
    'warmup',
  );
  await f.controller.continueSession(id);
  assert.equal(workoutFlow(active()).stage, 'warmup');
  f.clock(60_000);
  await f.controller.beginExercises(id);
  const warmupEnd = active().warmupEndedAt;
  assert.equal(workoutFlow(active()).stage, 'exercise');
  assert.equal(await f.controller.beginExercises(id), false);
  for (const set of active().exercises[0].sets) {
    f.controller.updateSet(id, exerciseId, set.id, 'weight', '60');
    await f.controller.startSet(id, exerciseId, set.id);
    await f.controller.showSession(id);
    const savedHub = readJournal(await f.scope.get('workout-journal.v1'), f.connection)
      .workouts[0];
    assert.equal(savedHub.runningSet?.setId, set.id);
    assert.equal(savedHub.flow?.stage, 'review');
    await f.controller.continueSession(id);
    assert.equal(await f.controller.advanceExercise(id), false);
    assert.equal(await f.controller.chooseExercise(id, secondId), false);
    f.clock(20_000);
    await f.controller.recordSet(id, exerciseId, set.id);
    if (set.id === active().exercises[0].sets.at(-1)!.id) {
      // The last set's rest runs on the summary (#3111).
      assert.equal(active().rest?.lastSet, true);
      assert.equal(active().restAnchor, null);
    } else {
      assert.ok(active().rest);
    }
  }
  assert.equal(workoutFlow(active()).stage, 'summary');
  const restored = readJournal(await f.scope.get('workout-journal.v1'), f.connection)
    .workouts[0];
  assert.equal(workoutFlow(restored).stage, 'summary');
  assert.equal(restored.warmupEndedAt, warmupEnd);
  assert.equal(f.requests.length, 0);
  f.clock(15_000);
  await f.controller.advanceExercise(id);
  assert.deepEqual(workoutFlow(active()), { stage: 'exercise', exerciseId: secondId });
  assert.equal(active().rest, null);
  assert.equal(active().exercises[0].sets.at(-1)?.restAfterSec, 0);
  await f.controller.startSet(id, secondId, active().exercises[1].sets[0].id);
  await f.controller.skipExercise(id);
  assert.equal(active().runningSet, null);
  assert.equal(active().exercises[1].sets[0].startedAt, null);
  assert.equal(active().exercises[1].sets[0].completedAt, null);
  assert.equal(workoutFlow(active()).stage, 'review');
  await f.controller.chooseExercise(id, exerciseId);
  assert.equal(workoutFlow(active()).stage, 'summary');
  const complete = finishWorkout(active(), f.clock());
  const payload = mutationFor(complete, complete.pending[0]).payload as {
    warmupEndedAtMs: number;
  };
  assert.equal(payload.warmupEndedAtMs, warmupEnd);
});

test('a failed navigation save keeps the durable warm-up and exercise step unchanged', async (t) => {
  const f = await setup(t);
  const scope = {
    ...f.scope,
    set: async () => {
      throw new Error('disk full');
    },
  };
  const id = (await f.controller.start(f.session, programId))!;
  f.controller.cancel();
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, f.clock);
  await controller.initialize();
  await controller.sync();
  assert.equal(await controller.beginExercises(id), false);
  assert.equal(workoutFlow(controller.getSnapshot().data.workouts[0]).stage, 'warmup');
  assert.equal(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0]
      .warmupEndedAt,
    null,
  );
});

test('older workouts resume their unfinished set without requiring a new warm-up or inventing its timing', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  const raw = JSON.parse((await f.scope.get('workout-journal.v1'))!);
  delete raw.workouts[0].flow;
  delete raw.workouts[0].warmupEndedAt;
  const restored = readJournal(JSON.stringify(raw), f.connection).workouts[0];
  assert.deepEqual(workoutFlow(restored), { stage: 'exercise', exerciseId });
  assert.equal(restored.id, id);
  assert.equal(restored.exercises[0].sets[0].weight, '60');
  const complete = finishWorkout(restored, f.clock());
  assert.equal(
    'warmupEndedAtMs' in (mutationFor(complete, complete.pending[0]).payload as object),
    false,
  );
  raw.workouts[0].flow = {
    stage: 'exercise',
    exerciseId: '10000000-0000-4000-8000-000000000099',
  };
  assert.throws(
    () => readJournal(JSON.stringify(raw), f.connection),
    /Missing saved workout exercise/,
  );
});

test('unequal supersets alternate using the shared order and survive reopening between members', async (t) => {
  const f = await setup(t);
  const partnerId = '10000000-0000-4000-8000-000000000044';
  const session = {
    ...f.session,
    exercises: [
      { ...f.session.exercises[0], supersetGroup: 7, setCount: 3 },
      { ...f.session.exercises[0], id: partnerId, name: 'Seated row', supersetGroup: 7 },
    ],
  };
  const id = (await f.controller.start(session, programId, true))!;
  await f.controller.beginExercises(id);
  const order: string[] = [];
  for (let count = 0; count < 5; count++) {
    const current = f.controller.getSnapshot().data.workouts[0];
    const flow = workoutFlow(current);
    const exercise = current.exercises.find(
      (exercise) => exercise.id === flow.exerciseId,
    )!;
    const set = exercise.sets.find((set) => set.completedAt === null)!;
    order.push(exercise.name);
    await f.controller.startSet(id, exercise.id, set.id);
    f.clock(1000);
    await f.controller.recordSet(id, exercise.id, set.id);
    const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection)
      .workouts[0];
    assert.deepEqual(
      workoutFlow(saved),
      workoutFlow(f.controller.getSnapshot().data.workouts[0]),
    );
  }
  assert.deepEqual(order, [
    'Bench press',
    'Seated row',
    'Bench press',
    'Seated row',
    'Bench press',
  ]);
  const finished = finishWorkout(f.controller.getSnapshot().data.workouts[0], f.clock());
  assert.equal(finished.pending.length, 3);
  assert.equal(
    (mutationFor(finished, finished.pending[0]).payload as { sets: number }).sets,
    3,
  );
  assert.equal(
    (mutationFor(finished, finished.pending[1]).payload as { sets: number }).sets,
    2,
  );
});

test('re-logging preserves the earlier sets and queues distinct log and set identities', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId))!;
  await f.controller.beginExercises(id);
  const first = f.controller.getSnapshot().data.workouts[0].exercises[0];
  for (const set of first.sets) {
    await f.controller.startSet(id, first.id, set.id);
    f.clock(1000);
    await f.controller.recordSet(id, first.id, set.id);
  }
  await f.controller.skipRest(id);
  const before = JSON.stringify(f.controller.getSnapshot().data.workouts[0].exercises[0]);
  await f.controller.redoExercise(id, first.id);
  assert.deepEqual(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0],
    f.controller.getSnapshot().data.workouts[0],
  );
  const redo = f.controller.getSnapshot().data.workouts[0].exercises[1];
  assert.equal(redo.relogOf, first.id);
  assert.equal(redo.lastDate, f.controller.getSnapshot().data.workouts[0].date);
  assert.deepEqual(
    redo.lastWeights,
    first.sets.map((x) => Number(x.weight)),
  );
  assert.deepEqual(
    redo.lastReps,
    first.sets.map((x) => Number(x.reps)),
  );
  assert.notEqual(redo.logId, first.logId);
  assert.ok(
    redo.sets.every((set) => !first.sets.some((previous) => previous.id === set.id)),
  );
  f.controller.updateSet(id, redo.id, redo.sets[0].id, 'weight', '70');
  await f.controller.recordSet(id, redo.id, redo.sets[0].id);
  assert.equal(
    JSON.stringify(f.controller.getSnapshot().data.workouts[0].exercises[0]),
    before,
  );
  const finished = finishWorkout(f.controller.getSnapshot().data.workouts[0], f.clock());
  const payloads = finished.pending
    .filter((item) => item.domain === 'workout_log')
    .map((item) => mutationFor(finished, item).payload as { exerciseLogId: string });
  assert.equal(new Set(payloads.map((payload) => payload.exerciseLogId)).size, 2);
});

test('an exercise swap preserves already-recorded loads under the original exercise name', async (t) => {
  const f = await setup(t);
  const { id } = await recordFirst(f);
  const previous = f.controller.getSnapshot().data.workouts[0].exercises[0];
  await f.controller.swapExercise(id, previous.id, {
    name: 'Push-up',
    exerciseType: 'bodyweight',
    muscles: ['chest'],
    mainMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    equipment: ['bodyweight'],
    instructions: null,
    estimated1rm: null,
    lastWeights: [],
    lastReps: [],
    lastDate: null,
  });
  const changed = f.controller.getSnapshot().data.workouts[0];
  assert.deepEqual(
    readJournal(await f.scope.get('workout-journal.v1'), f.connection).workouts[0],
    changed,
  );
  const replacement = changed.exercises.find((exercise) => !exercise.retired)!;
  const archive = changed.exercises.find((exercise) => exercise.retired)!;
  assert.equal(archive.name, 'Bench press');
  assert.equal(archive.sets[0].weight, '60');
  assert.equal(replacement.name, 'Push-up');
  assert.equal(replacement.sets[0].weight, '0');
  assert.notEqual(archive.logId, replacement.logId);
  await f.controller.recordSet(id, replacement.id, replacement.sets[0].id);
  const finished = finishWorkout(f.controller.getSnapshot().data.workouts[0], f.clock());
  const names = finished.pending
    .filter((item) => item.domain === 'workout_log')
    .map(
      (item) => (mutationFor(finished, item).payload as { exercise: string }).exercise,
    );
  assert.deepEqual(new Set(names), new Set(['Bench press', 'Push-up']));
});

test('timer choices persist per account and workout while hidden clocks still record actual durations', async (t) => {
  const f = await setup(t);
  const id = (await f.controller.start(f.session, programId, true))!;
  assert.deepEqual(f.controller.getSnapshot().data.workouts[0].timers, defaultTimers());
  assert.equal(
    await f.controller.configureTimers(
      id,
      {
        warmup: false,
        setup: false,
        setElapsed: false,
        workoutElapsed: false,
        warmupSeconds: 120,
      },
      true,
    ),
    true,
  );
  f.clock(40_000);
  await f.controller.beginExercises(id);
  f.clock(10_000);
  const [first, second] = f.controller.getSnapshot().data.workouts[0].exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  f.clock(50_000);
  await f.controller.startSet(id, exerciseId, second.id);
  f.clock(25_000);
  await f.controller.recordSet(id, exerciseId, second.id);
  f.clock(90_000);
  const active = f.controller.getSnapshot().data.workouts[0];
  // The summary times the last set's rest without recording it against the set (#3111).
  assert.equal(active.rest?.lastSet, true);
  assert.equal(active.restAnchor, null);
  assert.equal(active.exercises[0].sets[1].restAfterSec, 0);
  const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  assert.deepEqual(saved.workouts[0], active);
  assert.equal(saved.preferences.timers.warmup, false);
  assert.equal(saved.workouts[0].warmupGoalSource, 'selected');
  const finished = finishWorkout(active, f.clock());
  const payload = mutationFor(finished, finished.pending[0]).payload;
  assert.deepEqual(payload.setTimes, [20, 25]);
  assert.deepEqual(payload.restTimes, [50, 0]);
  assert.equal(payload.prepTimeSec, 10);
  assert.equal(workoutTiming(finished)[0].workActualSec, 45);
  await f.controller.discard(id);
  const nextId = (await f.controller.start(f.session, programId, true))!;
  const next = f.controller.getSnapshot().data.workouts.find((x) => x.id === nextId)!;
  assert.equal(next.timers.setElapsed, false);
  assert.equal(next.warmupGoalSeconds, 120);
  assert.equal(
    readJournal(null, { ...f.connection, userId: 'other' }).preferences.timers.warmup,
    true,
  );
});

test('unit changes preserve canonical kilograms and previous reuse changes only matching unstarted sets', async (t) => {
  const f = await setup(t);
  f.session.exercises[0].lastDate = '2026-10-10';
  f.session.exercises[0].lastReps = [5, 4];
  f.session.exercises[0].lastWeights = [10, 15];
  const id = (await f.controller.start(f.session, programId, true))!;
  const exercise = () => f.controller.getSnapshot().data.workouts[0].exercises[0];
  const [first, second] = exercise().sets;
  const targets = exercise().sets.map((x) => ({
    planned: x.planned,
    plannedWeight: x.plannedWeight,
  }));
  assert.equal(await f.controller.setWeightUnit(id, exerciseId, 'lb'), true);
  assert.equal(exercise().sets[0].weight, first.weight);
  assert.equal(exercise().weightUnit, 'lb');
  for (const pounds of ['5', '-20', '2.5', '2.76', '14.88', '15', '17.5']) {
    assert.equal(displayLoad(storedLoad(pounds, 'lb'), 'lb'), pounds);
  }
  assert.equal(displayLoad('-9', 'lb'), '-19.84');
  assert.equal(loadLabel('7.5'), '7.5 kg', 'every read-only surface shows kg, whatever the exercise unit');
  assert.equal(loadLabel(''), '');
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  const changes = previousValueChanges(exercise());
  assert.deepEqual(
    changes.map((x) => x.setId),
    [second.id],
  );
  assert.equal(await f.controller.reusePrevious(id, exerciseId, changes), true);
  assert.equal(exercise().sets[0].weight, first.weight);
  assert.equal(exercise().sets[1].weight, '15');
  assert.equal(exercise().sets[1].reps, '4');
  assert.equal(exercise().sets[1].completedAt, null);
  assert.equal(exercise().sets[1].rpeSource, 'expected');
  assert.deepEqual(
    exercise().sets.map((x) => ({ planned: x.planned, plannedWeight: x.plannedWeight })),
    targets,
  );
  assert.equal(await f.controller.reusePrevious(id, exerciseId, changes), false);
  assert.deepEqual(previousValueChanges({ ...exercise(), lastWeights: [10] }), []);
  const saved = readJournal(await f.scope.get('workout-journal.v1'), f.connection);
  assert.equal(saved.preferences.units[exerciseId], 'lb');
  assert.equal(saved.workouts[0].exercises[0].sets[1].weight, '15');
});

test('4, 10 and 20 sets keep stable IDs, original prescriptions and unmatched entries during copying', () => {
  for (const count of [4, 10, 20]) {
    const f = loggingFixture();
    const source = f.session.exercises[0];
    source.setCount = count;
    source.sets = Array.from({ length: count }, (_, number) => ({
      ...source.sets[0],
      number,
    }));
    source.lastDate = '2026-10-10';
    source.lastWeights = [10, 12.5, 15];
    source.lastReps = [8, 6, 4];
    const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
    const exercise = workout.exercises[0];
    assert.equal(exercise.sets.length, count);
    assert.equal(new Set(exercise.sets.map((x) => x.id)).size, count);
    assert.equal(previousValueChanges(exercise).length, 3);
    assert.equal(
      readJournal(
        JSON.stringify({ ...emptyJournal(f.connection), workouts: [workout] }),
        f.connection,
      ).workouts[0].exercises[0].sets.length,
      count,
    );
  }
});

test('style-less handoffs get the 90 s default rest, measured by the anchor, and summary waiting is recorded as next-exercise setup', async (t) => {
  const f = await setup(t);
  f.session.exercises[0].sets.forEach((x) => {
    x.restSeconds = 0;
  });
  const secondExerciseId = f.uuid();
  const session = {
    ...f.session,
    exercises: [
      ...f.session.exercises,
      { ...f.session.exercises[0], id: secondExerciseId, name: 'Row' },
    ],
  };
  const id = (await f.controller.start(session, programId, true))!;
  await f.controller.beginExercises(id);
  const active = () => f.controller.getSnapshot().data.workouts[0];
  const [first, second] = active().exercises[0].sets;
  await f.controller.startSet(id, exerciseId, first.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, first.id);
  assert.equal(active().rest!.endsAt - active().rest!.startedAt, 90_000);
  assert.ok(active().restAnchor);
  f.clock(15_000);
  await f.controller.startSet(id, exerciseId, second.id);
  f.clock(20_000);
  await f.controller.recordSet(id, exerciseId, second.id);
  f.clock(60_000);
  await f.controller.advanceExercise(id);
  f.clock(30_000);
  await f.controller.startSet(id, secondExerciseId, active().exercises[1].sets[0].id);
  f.clock(20_000);
  await f.controller.recordSet(id, secondExerciseId, active().exercises[1].sets[0].id);
  const completed = finishWorkout(active(), f.clock());
  const firstPayload = mutationFor(completed, completed.pending[0]).payload;
  const secondPayload = mutationFor(completed, completed.pending[1]).payload;
  assert.deepEqual(firstPayload.restTimes, [15, 0]);
  assert.equal(secondPayload.prepTimeSec, 30);
  assert.equal(secondPayload.interExerciseRestSec, 90);
  assert.equal(workoutTiming(completed)[1].setupActualSec, 90);
});

test('legacy snapshots gain optional timer defaults without fabricating effort, times or units', () => {
  const f = loggingFixture();
  const workout = createWorkout(f.session, programId, null, true, Date.now(), f.uuid);
  const raw = JSON.parse(
    JSON.stringify({ ...emptyJournal(f.connection), workouts: [workout] }),
  );
  delete raw.preferences;
  delete raw.workouts[0].timers;
  delete raw.workouts[0].restAnchor;
  raw.workouts[0].exercises.forEach(
    (x: { weightUnit?: string; sets: { startedAt: number | null }[] }) => {
      delete x.weightUnit;
    },
  );
  const restored = readJournal(JSON.stringify(raw), f.connection).workouts[0];
  assert.deepEqual(restored.timers, defaultTimers());
  assert.equal(restored.exercises[0].weightUnit, 'kg');
  assert.equal(restored.exercises[0].sets[0].startedAt, null);
  assert.equal(restored.warmupEndedAt, null);
  restored.exercises[0].sets[0].planned = null;
  restored.exercises[0].sets[0].completedAt = Date.now();
  const timing = workoutTiming(restored)[0];
  assert.equal(timing.workExpectedSec, null);
  assert.equal(timing.restExpectedSec, null);
  assert.equal(timing.workActualSec, null);
});
