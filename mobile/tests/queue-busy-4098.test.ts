// #4098: a 409 `busy: true` is the server saying "another save holds the lock, try again". A queued
// change retries it with the queue's normal backoff and never counts it toward being set aside; a
// real refusal (a 400, a 404, a 409 conflict without `busy`) is still counted exactly as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MUTATION_ATTEMPTS } from '@trainingai/shared/sync/push-retry';
import { ApiError } from '../src/features/account/api/client.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import { refusalOf } from '../src/core/sync/set-aside.ts';
import {
  BUSY_CEILING,
  BUSY_CEILING_MS,
  TrainingStore,
} from '../src/features/workouts/data/TrainingStore.ts';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function memory() {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
}
function busy() {
  const failure = new ApiError(409, undefined, undefined, '/api/workout-templates', true, 'busy');
  failure.busy = true;
  return failure;
}
const conflict = () =>
  new ApiError(409, undefined, undefined, '/api/workout-templates', true, 'Name taken');

test('refusalOf: busy is not a refusal, other JSON 4xx still are', () => {
  assert.equal(refusalOf(busy()), null);
  assert.equal(refusalOf(conflict()), 'push rejected: HTTP 409');
  assert.equal(refusalOf(new ApiError(400, undefined, undefined, '/api/x', true)), 'push rejected: HTTP 400');
  assert.equal(refusalOf(new ApiError(404, undefined, undefined, '/api/x', true)), 'push rejected: HTTP 404');
});

async function storeWith(answer: () => Error | null) {
  const posted: unknown[] = [];
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ programs: [] }),
    post: async (_path: string, body: unknown) => {
      const failure = answer();
      if (failure) throw failure;
      posted.push(body);
      const program = (body as { program: Record<string, unknown> }).program;
      return { ok: true, program: { ...program, id: id(900), userId: 'one' } };
    },
    delete: async () => {
      const failure = answer();
      if (failure) throw failure;
      return { ok: true };
    },
  } as unknown as AccountConnection;
  let seq = 1;
  const store = new TrainingStore(memory(), connection, () => id(seq++), () => {});
  await store.initialize();
  await store.saveProgram({
    name: 'Plan',
    isActive: true,
    phaseMode: 'manual',
    sessions: [
      { id: id(50), name: 'Upper', position: 0, exercises: [{ id: id(51), exerciseName: 'Bench press', position: 0 }] },
    ],
  });
  return { store, posted };
}
const trySync = (store: TrainingStore) => store.sync().catch(() => {});

test('a program save answered busy many times in a row is never set aside, then uploads', async () => {
  let busyAnswers = MAX_MUTATION_ATTEMPTS * 3;
  const { store, posted } = await storeWith(() => (busyAnswers-- > 0 ? busy() : null));
  for (let n = 0; n < MAX_MUTATION_ATTEMPTS * 3; n++) await trySync(store);
  assert.deepEqual(store.failed(), [], 'nothing set aside');
  assert.equal(store.getSnapshot().operations[0]?.rejected, undefined, 'no refusal counted');
  assert.equal(posted.length, 0);
  await trySync(store);
  assert.equal(posted.length, 1);
  assert.equal(store.getSnapshot().operations.length, 0);
});

test('a program save refused for real (a 409 conflict) is still set aside at the limit', async () => {
  const { store, posted } = await storeWith(() => conflict());
  for (let n = 0; n < MAX_MUTATION_ATTEMPTS; n++) await trySync(store);
  assert.equal(posted.length, 0);
  assert.equal(store.failed().length, 1);
  assert.equal(store.failed()[0].attempts, MAX_MUTATION_ATTEMPTS);
});

// Item 1 of the review: a busy answer never shows the refusal notice, and has a ceiling.
test('a busy answer shows the waiting line, never the refusal notice', async () => {
  const { store } = await storeWith(() => busy());
  await trySync(store);
  const error = store.getSnapshot().error ?? '';
  assert.match(error, /The server is busy saving another change\. This will upload shortly\./);
  assert.doesNotMatch(error, /refused|save corrections/);
});

async function stalledStore() {
  let clock = 1_000_000;
  const posts: { path: string; body: any }[] = [];
  let programBusy = true;
  const answers = { busy: 0 };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ programs: [] }),
    post: async (path: string, body: any) => {
      if (path === '/api/workout-templates') {
        if (programBusy) {
          answers.busy++;
          throw busy();
        }
        posts.push({ path, body });
        return { ok: true, program: { ...body.program, id: id(900), userId: 'one' } };
      }
      posts.push({ path, body });
      return { processed: 1, errors: [] };
    },
    delete: async () => {
      if (programBusy) {
        answers.busy++;
        throw busy();
      }
      return { ok: true };
    },
  } as unknown as AccountConnection;
  let seq = 1;
  const store = new TrainingStore(memory(), connection, () => id(seq++), () => {}, () => clock);
  await store.initialize();
  await store.saveProgram({
    name: 'Plan',
    isActive: true,
    phaseMode: 'manual',
    sessions: [
      { id: id(50), name: 'Upper', position: 0, exercises: [{ id: id(51), exerciseName: 'Bench press', position: 0 }] },
    ],
  });
  await store.saveProgram({
    name: 'Second',
    isActive: false,
    phaseMode: 'manual',
    sessions: [
      { id: id(60), name: 'Lower', position: 0, exercises: [{ id: id(61), exerciseName: 'Squat', position: 0 }] },
    ],
  });
  await store.saveInjury({ muscleName: 'chest', severity: 'mild', notes: null, startedDate: '2026-10-11' }, id(70));
  return {
    store,
    posts,
    answers,
    free: () => void (programBusy = false),
    tick: (ms: number) => void (clock += ms),
  };
}

test('after the ceiling a busy program save stops holding the injury behind it; programs stay in order; nothing is refused or dropped', async () => {
  const { store, posts, answers, free, tick } = await stalledStore();
  // Busy answers so far (saving already tried to sync) are counted by the connection, not guessed.
  while (answers.busy < BUSY_CEILING - 1) {
    tick(BUSY_CEILING_MS);
    await trySync(store);
    assert.equal(posts.length, 0, 'the head holds everything before the ceiling');
  }
  assert.match(store.getSnapshot().error ?? '', /busy saving another change/);
  // The ceiling answer.
  tick(BUSY_CEILING_MS);
  await trySync(store);
  assert.equal(posts.length, 1, 'only the injury went through');
  assert.equal(posts[0].path, '/api/sync/push');
  const error = store.getSnapshot().error ?? '';
  assert.match(error, /could not be uploaded yet/);
  assert.match(error, /Retry upload/);
  assert.doesNotMatch(error, /refused|save corrections/);
  const left = store.getSnapshot().operations;
  assert.deepEqual(left.map((operation) => operation.kind), ['program_save', 'program_save']);
  assert.equal(left[0].rejected, undefined, 'not marked refused');
  assert.deepEqual(store.failed(), []);
  // The second program stayed behind the first.
  free();
  await trySync(store);
  assert.deepEqual(
    posts.filter((post) => post.path === '/api/workout-templates').map((post) => post.body.program.name),
    ['Plan', 'Second'],
  );
  assert.equal(store.getSnapshot().operations.length, 0);
  assert.equal(store.getSnapshot().error, null);
});

test('busy answers below the time floor are not stalled even past the count', async () => {
  const { store, posts } = await stalledStore();
  for (let n = 0; n < BUSY_CEILING + 3; n++) await trySync(store);
  assert.equal(posts.length, 0, 'same instant: still held at the head');
  assert.match(store.getSnapshot().error ?? '', /busy saving another change/);
});
