// #4134 review: the name rule ("a lift needs something a person can see") is a rule for what the
// SERVER accepts. The native app parses the program list, its cached copy and its queued
// `program_save` commands with the shared write shape, so that shape must keep parsing a lift whose
// stored name is blank (here U+200B), or one such lift stops the whole list loading.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import { TrainingStore } from '../src/features/workouts/data/TrainingStore.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { programSpec } from '../src/features/workouts/data/models.ts';
import { sqliteFixture } from './storage-fixture.ts';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const BLANK = '​';

function stored(exerciseName: string) {
  return {
    id: id(1),
    userId: 'one',
    name: 'Saved plan',
    isActive: true,
    phaseMode: 'manual' as const,
    sessions: [
      {
        id: id(2),
        name: 'Upper',
        position: 0,
        exercises: [
          { id: id(3), exerciseName, position: 0 },
          { id: id(4), exerciseName: 'Bench press', position: 1 },
        ],
      },
    ],
  };
}

test('a program response with a blank-named lift parses', () => {
  const parsed = programSpec.schema.parse({ programs: [stored(BLANK)] });
  assert.equal(parsed.programs.length, 1);
  assert.equal(parsed.programs[0].sessions[0].exercises?.[0].exerciseName, BLANK);
});

test('the program list loads, and reloads from the cached copy, with one blank-named lift in it', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let online = true;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => {
      if (!online) throw new Error('offline');
      return { programs: [stored(BLANK), { ...stored('Row'), id: id(9) }] };
    },
    post: async () => ({}),
    delete: async () => ({}),
  };
  const scope = storage.account(connection.origin, 'one');
  let sequence = 500;
  const first = new WorkoutResources(scope, connection, Date.now, () => id(sequence++));
  await first.load(programSpec);
  assert.equal(first.state(programSpec).data?.programs.length, 2);
  online = false;
  const cached = new WorkoutResources(scope, connection, Date.now, () => id(sequence++));
  await cached.load(programSpec);
  assert.equal(cached.state(programSpec).data?.programs.length, 2);
});

test('a queued program save with a blank lift still parses and is sent; a 400 is counted, then set aside, and later saves go through', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const sent: string[] = [];
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ programs: [] }),
    post: async (path: string, body: unknown) => {
      const program = (body as { program: { name: string; sessions: { exercises: { exerciseName: string }[] }[] } }).program;
      sent.push(program.name);
      if (program.sessions[0].exercises.some((exercise) => exercise.exerciseName === BLANK)) {
        throw new ApiError(400, undefined, undefined, path, true, 'Give the exercise a name');
      }
      return { ok: true, program: { ...program, id: id(77), userId: 'one' } };
    },
    delete: async () => ({}),
  };
  let sequence = 600;
  const store = new TrainingStore(storage.account(connection.origin, 'one'), connection, () => id(sequence++), () => {});
  const blank = {
    name: 'Blank',
    isActive: false,
    phaseMode: 'manual' as const,
    sessions: [{ id: id(20), name: 'Upper', position: 0, exercises: [{ id: id(21), exerciseName: BLANK, position: 0 }] }],
  };
  await store.saveProgram(blank); // parses as a queued command
  assert.equal(store.getSnapshot().operations.length, 1);
  const outcomes: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    outcomes.push(await store.sync().then(() => 'ok', () => 'threw'));
  }
  assert.deepEqual(sent, Array(5).fill('Blank'), 'sent every time, and the server answered 400 each time');
  const [operation] = store.getSnapshot().operations;
  assert.equal(operation.rejected?.attempts, 5);
  assert.equal(operation.rejected?.error, 'push rejected: HTTP 400');
  // A save made after it is not held behind it for good: once the first is set aside, the queue passes over it.
  await store.saveProgram({ ...blank, name: 'Fine', sessions: [{ ...blank.sessions[0], id: id(30), exercises: [{ id: id(31), exerciseName: 'Row', position: 0 }] }] });
  await store.sync();
  assert.ok(sent.includes('Fine'), `later save sent (outcomes ${outcomes.join(',')})`);
  assert.equal(store.getSnapshot().operations.length, 1, 'only the set-aside save is left');
});
