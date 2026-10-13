import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { TrainingStore } from '../src/features/workouts/data/TrainingStore.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import {
  programSpec,
  injurySpec,
  type SavedProgram,
} from '../src/features/workouts/data/models.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { workoutActivity } from '../src/features/workouts/logging/activity-summary.ts';
import { loggingFixture } from './logging-fixture.ts';
import { createWorkout } from '../src/features/workouts/logging/workout.ts';

test('a lost phase-clone response is recovered before the queued program save', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let online = false;
  let cloneCalls = 0;
  const phase = {
    id: id(70),
    name: 'Progression',
    phases: [
      {
        name: 'Accumulation',
        phaseType: 'normal',
        durationCycles: 2,
        position: 0,
        primaryStyleId: id(71),
      },
    ],
  };
  const phases: unknown[] = [phase];
  let saved: SavedProgram | null = null;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async (path: string) => {
      if (!online) {
        throw new Error('offline');
      }
      return path === '/api/phase-sets' ? { phaseSets: phases } : { programs: [] };
    },
    post: async (path: string, body: unknown) => {
      if (path === '/api/phase-sets/clone') {
        cloneCalls++;
        phases.push({
          id: id(72),
          name: 'Progression (Saved plan)',
          phases: [
            {
              name: 'Baseline',
              phaseType: 'baseline',
              durationCycles: 1,
              position: 0,
              primaryStyleId: null,
            },
            { ...phase.phases[0], position: 1 },
          ],
        });
        throw new Error('response lost');
      }
      const payload = body as { program: SavedProgram; linkPhaseSetOwnership: boolean };
      assert.equal(payload.linkPhaseSetOwnership, true);
      saved = { ...payload.program, id: id(73), userId: 'one' };
      return { ok: true, program: saved };
    },
  };
  let sequence = 80;
  const store = new TrainingStore(
    storage.account(connection.origin, 'one'),
    connection,
    () => id(sequence++),
    () => {},
  );
  await store.saveProgram(
    { ...program(), phaseSetId: id(70) },
    {
      clone: {
        phaseSetId: id(70),
        programName: 'Saved plan',
        includeBaseline: true,
        overrides: {},
      },
    },
  );
  await store.sync();
  online = true;
  await store.sync();
  assert.equal(cloneCalls, 1);
  assert.equal(store.getSnapshot().operations.length, 1);
  await store.sync();
  assert.equal(cloneCalls, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal((saved as SavedProgram | null)?.phaseSetId, id(72));
});

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
test('editing during an upload keeps the newer local program through the earlier acknowledgement', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  f.setOnline(true);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hold = true;
  const seen: string[] = [];
  const connection = {
    ...f.connection,
    post: async (path: string, body: unknown) => {
      const result = await f.connection.post(path, body);
      if (hold) {
        hold = false;
        entered();
        await waiting;
      }
      return result;
    },
  };
  let store!: TrainingStore;
  store = new TrainingStore(
    storage.account(connection.origin, 'one'),
    connection,
    f.uuid,
    (confirmed) => {
      if (confirmed) {
        seen.push(store.getSnapshot().programs![0].name);
      }
    },
  );
  await store.initialize();
  await store.seed(programSpec.path, { programs: [{ ...program(), id: id(1), userId: 'one' }] });
  await store.saveProgram({ ...program('Earlier'), id: id(1) });
  await started;
  await store.saveProgram({ ...program('Newer'), id: id(1) });
  release();
  await store.sync();
  assert.deepEqual(seen, ['Newer', 'Newer']);
  assert.equal(f.remote()[0].name, 'Newer');
  assert.equal(store.getSnapshot().operations.length, 0);
});
function fixture() {
  let sequence = 100;
  let online = false;
  let lose = false;
  let creates = 0;
  let remote: SavedProgram[] = [];
  const writes: { path: string; body: unknown }[] = [];
  const get = async (path: string) => {
    if (!online) {
      throw new Error('offline');
    }
    if (path === programSpec.path) {
      return { programs: structuredClone(remote) };
    }
    if (path === injurySpec.path) {
      return [];
    }
    throw new Error('Unexpected fixture path');
  };
  const post = async (path: string, body: unknown) => {
    if (!online) {
      throw new Error('offline');
    }
    writes.push({ path, body: structuredClone(body) });
    if (path === '/api/sync/push') {
      return { processed: 1, errors: [] };
    }
    const payload = body as { program: SavedProgram };
    const value = { ...payload.program, id: payload.program.id ?? id(++creates), userId: 'one' };
    remote = remote
      .filter((program) => program.id !== value.id)
      .map((program) => (value.isActive ? { ...program, isActive: false } : program));
    remote.push(value);
    if (lose) {
      lose = false;
      throw new Error('response lost');
    }
    return { ok: true, program: structuredClone(value) };
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get,
    post,
    delete: async (_path: string, body: unknown) => {
      if (!online) {
        throw new Error('offline');
      }
      remote = remote.filter((program) => program.id !== (body as { id: string }).id);
      return { ok: true };
    },
  };
  return {
    connection,
    uuid: () => id(sequence++),
    setOnline: (value: boolean) => {
      online = value;
    },
    loseNext: () => {
      lose = true;
    },
    remote: () => remote,
    writes,
    creates: () => creates,
  };
}
function program(name = 'Saved plan', sessionId = id(50)) {
  return {
    name,
    isActive: true,
    phaseMode: 'manual' as const,
    sessions: [
      {
        id: sessionId,
        name: 'Upper',
        position: 0,
        exercises: [{ id: id(51), exerciseName: 'Bench press', position: 0 }],
      },
    ],
  };
}

test('offline program and injury saves reopen and replay stable identities after a lost create response', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const scope = storage.account(f.connection.origin, 'one');
  const store = new TrainingStore(scope, f.connection, f.uuid, () => {});
  await store.initialize();
  const localId = await store.saveProgram(program());
  await store.saveInjury(
    { muscleName: 'triceps', severity: 'mild', notes: null, startedDate: '2026-10-11' },
    id(60),
  );
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 2);
  assert.equal(store.getSnapshot().programs?.[0].id, localId);
  assert.equal(store.getSnapshot().injuries?.[0].id, id(60));
  store.cancel();
  const reopened = new TrainingStore(scope, f.connection, f.uuid, () => {});
  await reopened.initialize();
  await reopened.sync();
  assert.equal(reopened.getSnapshot().operations.length, 2);
  f.setOnline(true);
  f.loseNext();
  await reopened.sync();
  assert.equal(f.creates(), 1);
  assert.equal(reopened.getSnapshot().operations.length, 2);
  await reopened.sync();
  assert.equal(f.creates(), 1);
  assert.equal(reopened.getSnapshot().operations.length, 0);
  assert.equal(reopened.resolveProgramId(localId), f.remote()[0].id);
  assert.equal(reopened.getSnapshot().programs?.[0].id, f.remote()[0].id);
  const injury = f.writes.find((write) => write.path === '/api/sync/push')!.body as {
    mutations: { id: string; payload: { id: string } }[];
  };
  assert.equal(injury.mutations[0].payload.id, id(60));
});

test('correcting a pending create retains its attempted session fingerprint and does not duplicate the program', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const store = new TrainingStore(
    storage.account(f.connection.origin, 'one'),
    f.connection,
    f.uuid,
    () => {},
  );
  const localId = await store.saveProgram(program());
  await store.sync();
  f.setOnline(true);
  f.loseNext();
  await store.sync();
  assert.equal(f.creates(), 1);
  f.setOnline(false);
  await store.saveProgram({ ...program('Renamed plan', id(52)), id: localId });
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 1);
  f.setOnline(true);
  await store.sync();
  assert.equal(f.creates(), 1);
  assert.equal(f.remote()[0].name, 'Renamed plan');
  assert.equal(f.remote()[0].sessions[0].id, id(52));
  assert.equal(store.getSnapshot().operations.length, 0);
});

test('an earlier activation acknowledgement preserves a newer local active-program choice', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const active: string[][] = [];
  let store!: TrainingStore;
  store = new TrainingStore(
    storage.account(f.connection.origin, 'one'),
    f.connection,
    f.uuid,
    (confirmed) => {
      if (confirmed) {
        active.push(
          store
            .getSnapshot()
            .programs!.filter((program) => program.isActive)
            .map((program) => program.name),
        );
      }
    },
  );
  await store.saveProgram(program('First'));
  await store.sync();
  await store.saveProgram(program('Second', id(53)));
  await store.sync();
  f.setOnline(true);
  await store.sync();
  assert.deepEqual(active, [['Second'], ['Second']]);
  assert.equal(f.remote().filter((program) => program.isActive)[0].name, 'Second');
});

test('resource refresh and SQLite reopening preserve pending injuries and program edits', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const scope = storage.account(f.connection.origin, 'one');
  const resources = new WorkoutResources(scope, f.connection, Date.now, f.uuid);
  const localId = await resources.changes.saveProgram(program());
  await resources.changes.saveInjury(
    { muscleName: 'chest', severity: 'moderate', notes: 'Local note', startedDate: '2026-10-11' },
    id(60),
  );
  await resources.changes.sync();
  await resources.load(programSpec);
  await resources.load(injurySpec);
  assert.equal(resources.state(programSpec).data?.programs[0].id, localId);
  assert.equal(resources.state(injurySpec).data?.[0].notes, 'Local note');
  resources.cancel();
  const restored = new WorkoutResources(scope, f.connection, Date.now, f.uuid);
  await restored.load(programSpec);
  await restored.load(injurySpec);
  assert.equal(restored.state(injurySpec).data?.[0].notes, 'Local note');
  const revision = restored.changes.revision(injurySpec.path);
  await restored.changes.mergeRemote(injurySpec.path, [], revision);
  assert.equal(restored.changes.getSnapshot().injuries?.[0].notes, 'Local note');
  const other = new WorkoutResources(
    storage.account(f.connection.origin, 'two'),
    { ...f.connection, userId: 'two' },
    Date.now,
    f.uuid,
  );
  await other.load(programSpec);
  assert.equal(other.state(programSpec).data, null);
});

test('injury resolve/delete replay in order; rejections and failed local writes preserve the queue', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const scope = storage.account(f.connection.origin, 'one');
  let refuse = true;
  const connection = {
    ...f.connection,
    post: async (path: string, body: unknown) =>
      refuse ? { processed: 0, errors: [{ error: 'rejected' }] } : f.connection.post(path, body),
  };
  const store = new TrainingStore(scope, connection, f.uuid, () => {});
  await store.saveInjury(
    { muscleName: 'chest', severity: 'mild', notes: null, startedDate: '2026-10-11' },
    id(60),
  );
  await store.sync();
  await store.changeInjury(id(60), '2026-10-11');
  await store.changeInjury(id(60));
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 3);
  assert.deepEqual(store.getSnapshot().injuries, []);
  refuse = false;
  f.setOnline(true);
  await store.sync();
  assert.equal(store.getSnapshot().operations.length, 0);
  const payloads = f.writes.map(
    (write) =>
      (write.body as { mutations: { payload: Record<string, unknown> }[] }).mutations[0].payload,
  );
  assert.equal(payloads[0].muscleName, 'chest');
  assert.equal(payloads[1].resolvedDate, '2026-10-11');
  assert.equal(payloads[2].deleted, true);
  const broken = new TrainingStore(
    {
      ...scope,
      set: async () => {
        throw new Error('disk full');
      },
    },
    f.connection,
    f.uuid,
    () => {},
  );
  await broken.initialize();
  await assert.rejects(broken.saveProgram(program()));
  assert.deepEqual(broken.getSnapshot().operations, []);
});

test('sign-out during program recovery prevents the next POST and preserves scoped work', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = fixture();
  const scope = storage.account(f.connection.origin, 'one');
  const initial = new TrainingStore(scope, f.connection, f.uuid, () => {});
  await initial.saveProgram(program());
  await initial.sync();
  initial.cancel();
  let release!: (value: unknown) => void;
  const held = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  const store = new TrainingStore(
    scope,
    {
      ...f.connection,
      get: () => held,
      post: async () => {
        posts++;
        return {};
      },
    },
    f.uuid,
    () => {},
  );
  await store.initialize();
  const syncing = store.sync();
  store.cancel();
  release({ programs: [] });
  await syncing;
  assert.equal(posts, 0);
  const restored = new TrainingStore(scope, f.connection, f.uuid, () => {});
  await restored.initialize();
  await restored.sync();
  assert.equal(restored.getSnapshot().operations.length, 1);
});

test('compact workout state uses persisted set and rest timestamps without advancing the flow', () => {
  const f = loggingFixture();
  const now = Date.UTC(2026, 9, 11, 2);
  const workout = createWorkout(
    f.session,
    f.meta.program.id,
    'Australia/Brisbane',
    false,
    now,
    f.uuid,
  );
  const first = workout.exercises[0];
  const set = first.sets[0];
  const warmup = workoutActivity(workout, now + 5_000);
  assert.equal(warmup.label, 'Warm-up');
  workout.runningSet = { exerciseId: first.id, setId: set.id };
  set.startedAt = now + 5_000;
  assert.equal(workoutActivity(workout, now + 15_000).seconds, 10);
  workout.runningSet = null;
  workout.flow = { stage: 'exercise', exerciseId: first.id };
  workout.rest = {
    exerciseId: first.id,
    setId: set.id,
    startedAt: now + 15_000,
    endsAt: now + 105_000,
  };
  assert.equal(workoutActivity(workout, now + 40_000).seconds, 65);
  assert.equal(workoutActivity(workout, now + 110_000).timer, 'Overtime');
  assert.equal(workout.flow.stage, 'exercise');
});
