// #3638: no Preview outbox stops for good at one change. A change the server refuses for good, or
// whose read-back never shows it, is counted, set aside at MAX_MUTATION_ATTEMPTS where Sync health
// lists it, and the changes queued behind it upload. #3642: a server activity's "07:12:00" start
// time reaches every reader as "07:12".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_MUTATION_ATTEMPTS } from '@trainingai/shared/sync/push-retry';
import { activityPayload } from '../src/features/activities/data/models.ts';
import { ActivityStore } from '../src/features/activities/data/ActivityStore.ts';
import { failedItems } from '../src/features/activities/data/sync-health.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import { activityHistorySpec, healthDaySchema } from '../src/features/health/data/models.ts';
import { HistoryOutbox } from '../src/features/workouts/data/HistoryOutbox.ts';
import { TrainingStore } from '../src/features/workouts/data/TrainingStore.ts';
import { refusalOf, ChangeRefused } from '../src/core/sync/set-aside.ts';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
}
type Mutation = { id: string; domain: string; date: string; payload: Record<string, unknown> };
const mutationOf = (body: unknown) => (body as { mutations: Mutation[] }).mutations[0];
const refusal = (mutation: Mutation, error: string) => ({
  processed: 0,
  errors: [{ id: mutation.id, domain: mutation.domain, date: mutation.date, error }],
});
const origin = 'https://example.com';

test('only an answer about the change counts against it', () => {
  assert.equal(refusalOf(new ChangeRefused('No matching exercise log')), 'No matching exercise log');
  assert.equal(refusalOf(new ApiError(422, undefined, undefined, '/api/x', true)), 'push rejected: HTTP 422');
  // A proxy's page, a 429, a 5xx, the sign-in gate and a lost connection say nothing about it.
  assert.equal(refusalOf(new ApiError(422)), null);
  assert.equal(refusalOf(new ApiError(429, undefined, undefined, '/api/x', true)), null);
  assert.equal(refusalOf(new ApiError(503, undefined, undefined, '/api/x', true)), null);
  assert.equal(refusalOf(new ApiError(401, undefined, undefined, '/api/x', true)), null);
  assert.equal(refusalOf(new Error('offline')), null);
});

test('history: an edit of a log deleted elsewhere is set aside and the delete behind it uploads', async () => {
  const storage = memory();
  const posted: Mutation[] = [];
  let online = false;
  const connection = {
    origin,
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async (_path: string, body: unknown) => {
      if (!online) {
        throw new Error('offline');
      }
      const mutation = mutationOf(body);
      posted.push(mutation);
      return mutation.domain === 'exercise_log_edit'
        ? refusal(mutation, 'No matching exercise log for exerciseLogId')
        : { processed: 1, errors: [] };
    },
  } as unknown as AccountConnection;
  let seq = 1;
  const outbox = new HistoryOutbox(storage, connection, () => id(seq++), () => {});
  await outbox.initialize();
  await outbox.enqueue('exercise_log_edit', '2026-10-18', {
    exerciseLogId: id(500),
    weights: [60],
    reps: [8],
  });
  await outbox.enqueue('exercise_log_delete', '2026-10-18', { exerciseLogId: id(501) });
  await outbox.sync();
  online = true;
  for (let n = 0; n < MAX_MUTATION_ATTEMPTS - 1; n++) {
    await outbox.sync();
  }
  assert.deepEqual(
    posted.map((m) => m.domain),
    Array(MAX_MUTATION_ATTEMPTS - 1).fill('exercise_log_edit'),
    'the queue waits while the refusal is counted',
  );
  await outbox.sync();
  assert.deepEqual(
    posted.map((m) => m.domain),
    [...Array(MAX_MUTATION_ATTEMPTS).fill('exercise_log_edit'), 'exercise_log_delete'],
  );
  assert.deepEqual(
    outbox.failed().map((item) => [item.list, item.label, item.date, item.attempts]),
    [['history', 'Edited exercise', '2026-10-18', MAX_MUTATION_ATTEMPTS]],
  );
  assert.match(outbox.failed()[0].error, /No matching exercise log/);
  assert.equal(outbox.getSnapshot().operations.length, 1);
  // The refusal record is kept on this phone only; it is never sent to the server.
  assert.ok(posted.every((m) => !('rejected' in m)));
  await outbox.sync();
  assert.equal(posted.length, MAX_MUTATION_ATTEMPTS + 1, 'a set-aside change is not sent again');
  // It survives a restart, still set aside.
  const reopened = new HistoryOutbox(storage, connection, () => id(seq++), () => {});
  await reopened.initialize();
  await reopened.sync();
  assert.equal(reopened.failed().length, 1);
  assert.equal(posted.length, MAX_MUTATION_ATTEMPTS + 1);
  await reopened.discardRejected(reopened.failed()[0].id);
  assert.equal(reopened.getSnapshot().operations.length, 0);
});

test('history: a deleted activity the day still lists is counted, not retried for good', async () => {
  const storage = memory();
  let online = false;
  const connection = {
    origin,
    userId: 'one',
    get: async () => ({ date: '2026-10-18', activityLogs: [{ id: id(600) }] }),
    post: async () => {
      if (!online) {
        throw new Error('offline');
      }
      return { processed: 1, errors: [] };
    },
  } as unknown as AccountConnection;
  let seq = 1;
  const outbox = new HistoryOutbox(storage, connection, () => id(seq++), () => {});
  await outbox.initialize();
  await outbox.enqueue('activity_logs', '2026-10-18', { id: id(600), deleted: true });
  await outbox.sync();
  online = true;
  for (let n = 0; n < MAX_MUTATION_ATTEMPTS; n++) {
    await outbox.sync();
  }
  assert.deepEqual(
    outbox.failed().map((item) => [item.error, item.attempts]),
    [['Activity deletion readback not confirmed.', MAX_MUTATION_ATTEMPTS]],
  );
});

test('programs and injuries: a refused injury is set aside and the next change uploads', async () => {
  const storage = memory();
  const accepted: Mutation[] = [];
  let online = false;
  const connection = {
    origin,
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => {
      throw new Error('offline');
    },
    post: async (_path: string, body: unknown) => {
      if (!online) {
        throw new Error('offline');
      }
      const mutation = mutationOf(body);
      if (mutation.payload.id === id(60)) {
        return refusal(mutation, 'Invalid injury');
      }
      accepted.push(mutation);
      return { processed: 1, errors: [] };
    },
  } as unknown as AccountConnection;
  let seq = 80;
  const store = new TrainingStore(storage, connection, () => id(seq++), () => {});
  await store.initialize();
  await store.saveInjury(
    { muscleName: 'chest', severity: 'mild', notes: null, startedDate: '2026-10-11' },
    id(60),
  );
  await store.saveInjury(
    { muscleName: 'calf', severity: 'mild', notes: null, startedDate: '2026-10-12' },
    id(61),
  );
  await store.sync();
  online = true;
  for (let n = 0; n < MAX_MUTATION_ATTEMPTS - 1; n++) {
    await store.sync();
  }
  assert.equal(accepted.length, 0, 'held while the refusal is counted');
  await store.sync();
  assert.deepEqual(
    accepted.map((m) => m.payload.id),
    [id(61)],
  );
  assert.deepEqual(
    store.failed().map((item) => [item.list, item.label, item.date, item.error]),
    [['training', 'Injury', '2026-10-11', 'Invalid injury']],
  );
  // The injury stays on this phone while it is set aside.
  assert.ok(store.getSnapshot().injuries?.some((injury) => injury.id === id(60)));
});

test('activities: an accepted push the day never shows is counted, and the next activity uploads', async () => {
  const storage = memory();
  const server = new Map<string, Record<string, unknown>>();
  const pushes: string[] = [];
  let now = Date.parse('2026-10-12T12:00:00+10:00');
  const deletedElsewhere = id(700);
  const connection = {
    origin,
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ activityLogs: [...server.values()] }),
    post: async (_path: string, body: unknown) => {
      const mutation = mutationOf(body);
      pushes.push(String(mutation.payload.id));
      // The server keeps a tombstoned row deleted when the same id is pushed again.
      if (mutation.payload.id !== deletedElsewhere) {
        server.set(String(mutation.payload.id), { ...mutation.payload, distanceKm: null, notes: null });
      }
      return { processed: 1, errors: [] };
    },
  } as unknown as AccountConnection;
  let seq = 700;
  const store = new ActivityStore(storage, connection, () => id(seq++), () => {}, () => now);
  await store.initialize();
  const base = {
    date: '2026-10-12',
    activityType: 'treadmill',
    title: 'Treadmill',
    durationMin: 20,
  };
  await store.saveRecord({ ...base, id: deletedElsewhere, startTime: '07:00', endTime: '07:20' });
  await store.saveRecord({ ...base, id: id(701), startTime: '12:00', endTime: '12:20' });
  for (let hour = 0; hour < 10; hour++) {
    now += 3_600_000;
    await store.sync();
  }
  const rows = store.getSnapshot().rows;
  const stuck = rows.find((row) => row.payload.id === deletedElsewhere)!;
  const next = rows.find((row) => row.payload.id === id(701))!;
  assert.equal(next.pending, false, 'the activity behind it uploaded');
  assert.equal(stuck.pending, true);
  assert.equal(stuck.rejected?.error, 'Readback not confirmed.');
  assert.deepEqual(
    failedItems(store.getSnapshot()).map((item) => [item.id, item.attempts]),
    [[deletedElsewhere, MAX_MUTATION_ATTEMPTS]],
  );
  assert.equal(pushes.filter((pushed) => pushed === deletedElsewhere).length, MAX_MUTATION_ATTEMPTS);
});

test('a server activity start time with seconds reaches every reader as HH:MM (#3642)', () => {
  // As /api/activity-logs and /api/day-log send it: a Postgres `time` column.
  const serverRow = {
    id: id(800),
    date: '2026-10-12',
    activityType: 'run',
    durationMin: 32,
    distanceKm: 5.2,
    title: 'Morning run',
    startTime: '07:12:00',
    endTime: '07:44:00',
    notes: null,
    source: 'manual',
  };
  const [log] = activityHistorySpec.schema.parse({ activityLogs: [serverRow] }).activityLogs;
  assert.equal(log.startTime, '07:12');
  assert.equal(log.endTime, '07:44');
  // The day read shares the shape.
  const day = healthDaySchema.parse({ date: '2026-10-12', exercises: [], activityLogs: [serverRow] });
  assert.equal(day.activityLogs[0].startTime, '07:12');
  // An "HH:MM" value and a missing one pass through as they are.
  const [plain] = activityHistorySpec.schema.parse({
    activityLogs: [{ ...serverRow, startTime: '06:05', endTime: null }],
  }).activityLogs;
  assert.equal(plain.startTime, '06:05');
  assert.equal(plain.endTime, null);
  // The editor spreads the row into its payload (ActivityEditor.tsx): it now parses.
  const payload = {
    ...Object.fromEntries(Object.entries(log).filter(([, value]) => value != null)),
    title: 'Renamed run',
  };
  assert.equal(activityPayload.safeParse(payload).success, true);
});
