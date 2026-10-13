import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { ApiError } from '../src/features/account/api/client.ts';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { HistoryOutbox, overlayHistory } from '../src/features/workouts/data/HistoryOutbox.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { prepareSession } from '../src/features/workouts/logging/session-options.ts';
import { workoutFixture } from './workout-fixture.ts';
import { buildCatalog } from '../src/features/workouts/catalog.ts';
import { builderSteps, generatedDraft } from '../src/features/programs/builder-model.ts';
import { programPayload } from '../src/features/programs/editor-model.ts';

test('a successful write expires persisted views even if they were not opened in that app session', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const scope = storage.account('https://example.com', 'one');
  let value = 1;
  let reads = 0;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => {
      reads++;
      return { value };
    },
    post: async () => {
      value = 2;
      return {};
    },
  };
  const spec = { path: '/api/strength-trend', schema: z.object({ value: z.number() }) };
  await new WorkoutResources(scope, connection).load(spec);
  await new WorkoutResources(scope, connection).write('POST', '/api/sync/push', {}, [spec.path]);
  const restarted = new WorkoutResources(scope, connection);
  await restarted.load(spec);
  assert.equal(reads, 2);
  assert.equal(restarted.state(spec).data?.value, 2);
});

test('media requests share a download and a failed disk save does not hide loaded media', async () => {
  let downloads = 0;
  const image = 'data:image/png;base64,c2FtcGxl';
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => null,
    post: async () => ({}),
    media: async () => {
      downloads++;
      return image;
    },
  };
  const storage = {
    get: async () => null,
    set: async () => {
      throw new Error('disk full');
    },
    remove: async () => {},
  };
  const resources = new WorkoutResources(storage, connection);
  const loaded = await Promise.all([
    resources.media('/exercise-media/press.gif'),
    resources.media('/exercise-media/press.gif'),
  ]);
  assert.deepEqual(loaded, [image, image]);
  assert.equal(downloads, 1);
});

test('saved views and drafts survive SQLite reopening, share reads and isolate accounts', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let calls = 0;
  let now = 100_000;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => {
      calls++;
      return { count: 5 };
    },
    post: async () => ({}),
  };
  const spec = { path: '/api/weekly-stats', schema: z.object({ count: z.number() }) };
  const scope = storage.account(connection.origin, connection.userId);
  const resources = new WorkoutResources(scope, connection, () => now);
  await Promise.all([resources.load(spec), resources.load(spec)]);
  assert.equal(calls, 1);
  await resources.saveDraft('program-new', { name: 'Unsaved plan' });
  const restored = new WorkoutResources(scope, connection, () => now);
  await restored.load(spec);
  assert.equal(calls, 1);
  assert.equal(restored.state(spec).data?.count, 5);
  assert.deepEqual(await restored.draft('program-new', z.object({ name: z.string() })), {
    name: 'Unsaved plan',
  });
  now += 300_000;
  await restored.load(spec);
  assert.equal(calls, 2);
  const other = new WorkoutResources(
    storage.account(connection.origin, 'two'),
    {
      ...connection,
      userId: 'two',
      get: async () => {
        throw new ApiError(403);
      },
    },
    () => now,
  );
  await other.load(spec);
  assert.equal(other.state(spec).data, null);
  assert.equal(await other.draft('program-new', z.object({ name: z.string() })), null);
});

test('tap-to-load cards only read local cache until opened; invalidated in-flight reads cannot replace fresh data', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let calls = 0;
  let value = 1;
  let release!: () => void;
  let hold = false;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spec = { path: '/api/next-session/prescription', schema: z.object({ value: z.number() }) };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => {
      calls++;
      const snapshot = value;
      if (hold) {
        hold = false;
        await waiting;
      }
      return { value: snapshot };
    },
    post: async () => ({}),
  };
  const resources = new WorkoutResources(storage.account(connection.origin, 'one'), connection);
  await resources.load(spec, false, true);
  assert.equal(calls, 0);
  await resources.load(spec);
  assert.equal(calls, 1);
  hold = true;
  const fetching = resources.load(spec, true);
  while (calls < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  value = 2;
  resources.invalidate([spec.path]);
  release();
  await fetching;
  assert.equal(calls, 3);
  assert.equal(resources.state(spec).data?.value, 2);
});

test('offline history edits replay ordered stable identities and preserve pending changes on rejection', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const scope = storage.account('https://example.com', 'one');
  let online = false;
  const ids: string[] = [];
  let sequence = 1;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: null,
    get: async () => null,
    post: async (_path: string, body: unknown) => {
      const change = (body as { mutations: { id: string }[] }).mutations[0];
      ids.push(change.id);
      if (!online) {
        throw new Error('offline');
      }
      return { processed: 1, errors: [] };
    },
  };
  const queue = new HistoryOutbox(
    scope,
    connection,
    () => `20000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    () => {},
  );
  await queue.initialize();
  const id = '10000000-0000-4000-8000-000000000003';
  await queue.enqueue('exercise_log_edit', '2026-10-11', {
    exerciseLogId: id,
    weights: [70],
    reps: [8],
  });
  await queue.sync();
  assert.equal(queue.getSnapshot().operations.length, 1);
  queue.cancel();
  const restored = new HistoryOutbox(
    scope,
    connection,
    () => `20000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    () => {},
  );
  await restored.initialize();
  await restored.sync();
  const pending = restored.getSnapshot().operations;
  assert.deepEqual(
    overlayHistory(
      [{ exerciseLogId: id, workoutSessionId: 'session', setWeights: [60], reps: [6] }],
      pending,
    )[0].setWeights,
    [70],
  );
  online = true;
  await restored.sync();
  assert.equal(restored.getSnapshot().operations.length, 0);
  assert.ok(ids.every((id) => id === ids[0]));
  await assert.rejects(
    restored.enqueue('exercise_log_edit', '2026-10-11', {
      exerciseLogId: id,
      weights: [Infinity],
      reps: [8],
    }),
  );
});

test('full and per-exercise overrides restore server-provided styles without altering the cached prescription', () => {
  const fixture = workoutFixture();
  const session = buildCatalog(fixture.meta, fixture.next, fixture.all, fixture.reader).program!
    .sessions[0];
  session.exercises[0].deloaded = true;
  session.exercises[0].preDeloadStyle = [{ number: 1, reps: 5, percent: 80, restSeconds: 120 }];
  session.exercises[0].preDeloadSets = 1;
  const full = prepareSession(session, { fullOverride: true, durationPreset: 30 });
  assert.equal(full.exercises[0].deloaded, false);
  assert.equal(full.exercises[0].sets[0].percent, 80);
  assert.equal(full.budgetMinutes, 30);
  assert.equal(session.exercises[0].deloaded, true);
  const missing = prepareSession(
    { ...session, exercises: [{ ...session.exercises[0], preDeloadStyle: null }] },
    { fullOverride: true },
  );
  assert.equal(missing.exercises[0].deloaded, true);
});

test('builder skips the same questions as the web and preserves exercise IDs across save retries', () => {
  assert.deepEqual(builderSteps('ai'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(builderSteps('linear'), [1, 2, 3, 4, 5, 6, 7, 9, 10]);
  let sequence = 1;
  const inputs = {
    programName: 'Plan',
    equipment: ['barbell'],
    sessionsPerWeek: 3,
    timePerSessionMinutes: 60,
    musclesToFocus: ['Chest'],
    goal: 'strength' as const,
    progressionMode: 'phase' as const,
    phaseStructureName: 'Strength',
    totalWeeks: 12,
    scheduleType: 'rotation' as const,
    rotationRestAfterN: 3,
    weeklyDays: [0, 2, 4],
  };
  const draft = generatedDraft(
    {
      name: 'Plan',
      phaseStructureName: 'Strength',
      phaseSetId: 'set',
      reasoning: '',
      phases: [],
      sessions: [
        {
          name: 'Upper',
          icon: '💪',
          exercises: [
            {
              name: 'Bench press',
              exerciseRole: 'primary',
              mainMuscles: ['chest'],
              secondaryMuscles: ['triceps'],
              progressionStyleId: 'style',
            },
          ],
        },
      ],
    },
    inputs,
    () => `20000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
  );
  const first = programPayload(draft);
  const second = programPayload({ ...draft, name: 'Renamed' });
  assert.equal(
    first.program.sessions?.[0].exercises?.[0].id,
    second.program.sessions?.[0].exercises?.[0].id,
  );
  assert.equal(first.program.schedule?.restAfterN, 3);
});
