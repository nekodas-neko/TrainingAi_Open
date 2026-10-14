import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  buildCatalog,
  readSavedCatalog,
  sessionTrainingStatus,
} from '../src/features/workouts/catalog.ts';
import { WorkoutCatalogStore } from '../src/features/workouts/WorkoutCatalogStore.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { workoutFixture } from './workout-fixture.ts';
import { exerciseId, programId, sessionId } from './logging-fixture.ts';
import { createWorkout, emptyJournal, readJournal } from '../src/features/workouts/logging/workout.ts';

test('parses the actual API set shape and preserves server recommendation and prescription', () => {
  const f = workoutFixture();
  Object.assign(f.all.perSession['session-one'].exercises[0], {
    lastDate: '2026/10/11',
    loggedTodayInSession: true,
  });
  Object.assign(f.all.perSession['session-one'], { dataDate: '2026/10/11' });
  const catalog = buildCatalog(f.meta, f.next, f.all, f.reader, 123);
  const session = catalog.program!.sessions[0];
  assert.equal(session.durationMinutes, 42);
  assert.equal(session.phase, 'Build');
  assert.equal(session.trainedDate, '2026-10-11');
  const at = new Date('2026-10-11T00:00:00Z');
  assert.equal(sessionTrainingStatus(session, [], 'Australia/Brisbane', at).completed, true);
  const unlogged = { ...session, trainedDate: null, lastTrained: '2026/10/10' };
  assert.equal(
    sessionTrainingStatus(unlogged, ['2026-10-11'], 'Australia/Brisbane', at).completed,
    true,
  );
  assert.equal(
    sessionTrainingStatus(unlogged, ['2026/10/11'], 'Australia/Brisbane', at).completed,
    true,
  );
  assert.equal(
    sessionTrainingStatus(unlogged, [], 'Australia/Brisbane', at).lastTrained,
    'Last done yesterday',
  );
  assert.equal(
    sessionTrainingStatus(unlogged, ['2026-10-11'], 'America/Los_Angeles', at).completed,
    false,
  );
  assert.deepEqual(session.exercises[0].sets, [
    { number: 1, reps: 8, percent: 70, restSeconds: 90, useFor1rm: true },
    { number: 2, reps: 6, percent: 75, restSeconds: 120, useFor1rm: true },
  ]);
  assert.deepEqual(readSavedCatalog(JSON.stringify(catalog), f.reader), catalog);
  assert.equal(
    readSavedCatalog(JSON.stringify(catalog), { ...f.reader, userId: 'someone-else' }),
    null,
  );
  assert.equal(
    readSavedCatalog(JSON.stringify(catalog), { ...f.reader, origin: 'https://other.example' }),
    null,
  );
  assert.equal(readSavedCatalog('{broken', f.reader), null);
  const incomplete = JSON.parse(JSON.stringify(catalog));
  delete incomplete.program.sessions[0].durationMinutes;
  assert.equal(readSavedCatalog(JSON.stringify(incomplete), f.reader), null);
});

test('accepts the last session average reps, which the server sends to one decimal', () => {
  // `prevRepMaxReps` is the last session's `avg_reps`, so 8, 8 and 9 reps arrive as 8.3. Treating it
  // as a whole count failed the whole catalogue for any real history (Program unavailable, #2897).
  const f = workoutFixture();
  f.meta.program.id = programId;
  f.meta.program.sessions[0].id = sessionId;
  f.meta.program.sessions[0].programId = programId;
  f.meta.program.sessions[0].exercises[0].id = exerciseId;
  const response = f.all.perSession['session-one'];
  Object.assign(response.exercises[0], { sessionExerciseId: exerciseId, prevRepMaxReps: 8.3 });
  const catalog = buildCatalog(f.meta, f.next, { perSession: { [sessionId]: response } }, f.reader);
  const session = catalog.program!.sessions[0];
  assert.equal(session.exercises[0].prevRepMaxReps, 8.3);
  assert.deepEqual(readSavedCatalog(JSON.stringify(catalog), f.reader), catalog);
  let id = 0;
  const workout = createWorkout(
    session,
    programId,
    'Australia/Brisbane',
    false,
    Date.parse('2026-10-12T01:00:00Z'),
    () => `20000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  );
  const journal = { ...emptyJournal(f.reader), workouts: [workout] };
  const saved = readJournal(JSON.stringify(journal), f.reader);
  assert.equal(saved.workouts[0].exercises[0].prevRepMaxReps, 8.3);
});

test('rejects cross-account, inconsistent session and malformed prescription responses', () => {
  const f = workoutFixture();
  assert.throws(() => buildCatalog(f.meta, f.next, f.all, { ...f.reader, userId: 'someone-else' }));
  f.next.session = { ...f.next.session, id: 'removed-session' };
  assert.throws(() => buildCatalog(f.meta, f.next, f.all, f.reader));
  f.next.session = f.meta.program.sessions[0];
  f.all.perSession['session-one'].exercises[0].sessionExerciseId = 'foreign-exercise';
  assert.throws(() => buildCatalog(f.meta, f.next, f.all, f.reader));
  f.all.perSession['session-one'].exercises[0].sessionExerciseId = 'exercise-one';
  f.all.perSession['session-one'].exercises[0].progressionStyle[0].pct = NaN;
  assert.throws(() => buildCatalog(f.meta, f.next, f.all, f.reader));
});

test('SQLite restores the previous program offline and separates accounts and backends', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  const scope = storage.account(f.reader.origin, f.reader.userId);
  await new WorkoutCatalogStore(scope, f.reader, () => 0).initialize();
  const offline = {
    ...f.reader,
    get: async () => {
      throw new Error('offline');
    },
  };
  const restored = new WorkoutCatalogStore(scope, offline);
  await restored.initialize();
  assert.equal(restored.getSnapshot().source, 'saved');
  assert.equal(restored.getSnapshot().catalog?.program?.name, 'Strength plan');
  assert.deepEqual(restored.getSnapshot().catalog?.program?.sessions[0].muscleActivations, [
    { muscle: 'chest', role: 'main' },
    { muscle: 'triceps', role: 'secondary' },
  ]);
  assert.deepEqual(restored.getSnapshot().catalog?.recovery, [{ muscle: 'chest', pct: 42 }]);
  assert.match(restored.getSnapshot().notice!, /saved version/);
  for (const reader of [
    { ...offline, userId: 'user-two' },
    { ...offline, origin: 'https://other.example' },
  ]) {
    const other = new WorkoutCatalogStore(storage.account(reader.origin, reader.userId), reader);
    await other.initialize();
    assert.equal(other.getSnapshot().catalog, null);
    assert.equal(other.getSnapshot().status, 'error');
  }
});

test('shows saved data while refreshing; concurrent refreshes share requests', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  const scope = storage.account(f.reader.origin, f.reader.userId);
  await new WorkoutCatalogStore(scope, f.reader, () => 0).initialize();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      requests++;
      await waiting;
      return f.reader.get(path, query);
    },
  };
  const restored = new WorkoutCatalogStore(scope, reader);
  const loading = restored.initialize();
  while (requests === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(restored.getSnapshot().catalog?.program?.name, 'Strength plan');
  assert.equal(restored.getSnapshot().refreshing, true);
  assert.equal(restored.getSnapshot().cacheReady, true);
  const refresh = restored.refresh();
  assert.equal(restored.refresh(), refresh);
  release();
  await Promise.all([loading, refresh]);
  assert.equal(requests, 5);
  assert.equal(restored.getSnapshot().source, 'server');
});

test('an empty local cache finishes startup without waiting for program downloads', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      requests++;
      await waiting;
      return f.reader.get(path, query);
    },
  };
  const controller = new WorkoutCatalogStore(storage.account(reader.origin, reader.userId), reader);
  assert.equal(controller.getSnapshot().cacheReady, false);
  const loading = controller.initialize();
  while (!requests) { await new Promise((resolve) => setImmediate(resolve)); }
  assert.equal(controller.getSnapshot().cacheReady, true);
  assert.equal(controller.getSnapshot().catalog, null);
  assert.equal(controller.getSnapshot().status, 'loading');
  release();
  await loading;
});

test('a removed active program replaces the old cache without loading session details', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  const scope = storage.account(f.reader.origin, f.reader.userId);
  await new WorkoutCatalogStore(scope, f.reader, () => 0).initialize();
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      if (path === '/api/next-session') {
        return { isRestDay: false, reason: 'No active program configured' };
      }
      assert.equal(query?.tab, 'meta');
      return { exercises: [], sessions: [] };
    },
  };
  const controller = new WorkoutCatalogStore(scope, reader);
  await controller.initialize();
  assert.equal(controller.getSnapshot().catalog?.program, null);
  const restored = new WorkoutCatalogStore(scope, {
    ...reader,
    get: async () => {
      throw new Error('offline');
    },
  });
  await restored.initialize();
  assert.equal(restored.getSnapshot().catalog?.program, null);
});

test('authorization failures hide cached data; transient failures retain it', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  for (const status of [500, 401, 403]) {
    let fail = false;
    const reader = {
      ...f.reader,
      get: async (path: string, query?: Record<string, string>) => {
        if (fail) {
          throw new ApiError(status);
        }
        return f.reader.get(path, query);
      },
    };
    const controller = new WorkoutCatalogStore(
      storage.account(reader.origin, reader.userId),
      reader,
    );
    await controller.initialize();
    fail = true;
    await controller.refresh();
    assert.equal(controller.getSnapshot().status, status === 500 ? 'ready' : 'unauthorized');
    assert.equal(controller.getSnapshot().catalog === null, status !== 500);
  }
});

test('cancelled responses cannot populate the cache or continue requesting session details', async () => {
  const f = workoutFixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const writes: string[] = [];
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      calls.push(query?.tab ?? path);
      await waiting;
      return f.reader.get(path, query);
    },
  };
  const controller = new WorkoutCatalogStore(
    {
      get: async () => null,
      set: async (_key, value) => {
        writes.push(value);
      },
      remove: async () => {},
    },
    reader,
  );
  const loading = controller.initialize();
  while (calls.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  controller.cancel();
  release();
  await loading;
  assert.deepEqual(calls, ['meta', '/api/next-session']);
  assert.equal(writes.length, 0);
  assert.equal(controller.getSnapshot().catalog, null);
});

test('a disk write failure retains live data and a later retry saves it', async () => {
  const f = workoutFixture();
  let saved: string | null = null;
  let fail = true;
  const controller = new WorkoutCatalogStore(
    {
      get: async () => saved,
      remove: async () => {},
      set: async (_key, value) => {
        if (fail) {
          throw new Error('disk full');
        }
        saved = value;
      },
    },
    f.reader,
  );
  await controller.initialize();
  assert.equal(controller.getSnapshot().source, 'server');
  assert.match(controller.getSnapshot().notice!, /could not be saved/);
  fail = false;
  await controller.refresh();
  assert.equal(controller.getSnapshot().notice, null);
  assert.ok(readSavedCatalog(saved, f.reader));
});

test('fresh saved data skips automatic checks; stale checks are quiet and manual refresh bypasses freshness', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  const scope = storage.account(f.reader.origin, f.reader.userId);
  let now = 100_000;
  await new WorkoutCatalogStore(scope, f.reader, () => now).initialize();
  let requests = 0;
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      requests++;
      return f.reader.get(path, query);
    },
  };
  const controller = new WorkoutCatalogStore(scope, reader, () => now);
  await controller.initialize();
  await controller.refreshIfStale();
  now += 299_999;
  await controller.refreshIfStale();
  assert.equal(requests, 0);
  assert.equal(controller.getSnapshot().source, 'saved');
  now++;
  const automatic = controller.refreshIfStale();
  assert.equal(controller.getSnapshot().refreshing, true);
  assert.equal(controller.getSnapshot().refreshingManually, false);
  assert.equal(controller.getSnapshot().catalog?.program?.name, 'Strength plan');
  assert.equal(controller.refreshIfStale(), automatic);
  const manual = controller.refresh();
  assert.equal(manual, automatic);
  assert.equal(controller.getSnapshot().refreshingManually, true);
  await automatic;
  assert.equal(requests, 5);
  await controller.refresh();
  assert.equal(requests, 10);
  now += 300_000;
  await controller.refreshIfStale();
  assert.equal(requests, 15);
});

test('failed automatic checks back off, keep saved data and allow an immediate manual retry', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  let now = 100_000;
  let requests = 0;
  let offline = false;
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      requests++;
      if (offline) {
        throw new Error('offline');
      }
      return f.reader.get(path, query);
    },
  };
  const controller = new WorkoutCatalogStore(
    storage.account(reader.origin, reader.userId),
    reader,
    () => now,
  );
  await controller.initialize();
  offline = true;
  now += 300_000;
  await controller.refreshIfStale();
  const notice = controller.getSnapshot().notice;
  assert.match(notice!, /saved version/);
  for (let visit = 0; visit < 5; visit++) {
    await controller.refreshIfStale();
  }
  assert.equal(requests, 7);
  assert.equal(controller.getSnapshot().catalog?.program?.name, 'Strength plan');
  now += 30_000;
  const retry = controller.refreshIfStale();
  assert.equal(controller.getSnapshot().notice, notice);
  await retry;
  assert.equal(requests, 9);
  now += 59_999;
  await controller.refreshIfStale();
  assert.equal(requests, 9);
  now++;
  await controller.refreshIfStale();
  assert.equal(requests, 11);
  offline = false;
  await controller.refresh();
  assert.equal(requests, 16);
  assert.equal(controller.getSnapshot().notice, null);
  await controller.refreshIfStale();
  assert.equal(requests, 16);
});

test('a completed write invalidates fresh data and rechecks if an older request is already running', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = workoutFixture();
  let now = 100_000;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let wait = false;
  let requestedAll!: () => void;
  const requested = new Promise<void>((resolve) => {
    requestedAll = resolve;
  });
  let requests = 0;
  const reader = {
    ...f.reader,
    get: async (path: string, query?: Record<string, string>) => {
      requests++;
      const value = structuredClone(await f.reader.get(path, query));
      if (wait && query?.tab === 'all') {
        wait = false;
        requestedAll();
        await waiting;
      }
      return value;
    },
  };
  const controller = new WorkoutCatalogStore(
    storage.account(reader.origin, reader.userId),
    reader,
    () => now,
  );
  await controller.initialize();
  await controller.invalidate();
  assert.equal(requests, 10);
  now += 300_000;
  wait = true;
  const checking = controller.refreshIfStale();
  await requested;
  f.next.reason = 'Changed after completing a workout';
  const invalidated = controller.invalidate();
  release();
  await Promise.all([checking, invalidated]);
  assert.equal(requests, 20);
  assert.equal(controller.getSnapshot().catalog?.recommendation.reason, f.next.reason);
  assert.equal(controller.getSnapshot().refreshingManually, false);
  await controller.refreshIfStale();
  assert.equal(requests, 20);
});

test('invalidation while restoring fresh saved data still checks the server', async () => {
  const f = workoutFixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = JSON.stringify(buildCatalog(f.meta, f.next, f.all, f.reader, 100_000));
  let requests = 0;
  const controller = new WorkoutCatalogStore(
    {
      get: async () => {
        await waiting;
        return saved;
      },
      set: async () => {},
      remove: async () => {},
    },
    {
      ...f.reader,
      get: async (path, query) => {
        requests++;
        return f.reader.get(path, query);
      },
    },
    () => 100_000,
  );
  const loading = controller.initialize();
  const invalidated = controller.invalidate();
  release();
  await Promise.all([loading, invalidated]);
  assert.equal(requests, 5);
  assert.equal(controller.getSnapshot().source, 'server');
  assert.equal(controller.getSnapshot().refreshingManually, false);
});
