import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discardRow,
  failedHeading,
  failedItems,
  itemDetail,
  itemTitle,
  retryNotice,
  retryRow,
  waitingCount,
} from '../src/features/activities/data/sync-health.ts';
import { ActivityStore } from '../src/features/activities/data/ActivityStore.ts';
import type { AccountConnection } from '../src/features/account/session.ts';

const dead = { error: 'Bad payload', at: 1, attempts: 5 };
const row = (id: string, rejected?: { error: string; at: number; attempts: number }) => ({
  payload: { id, date: '2026-10-20' },
  pending: true,
  rejected,
});
const queues = () => ({
  rows: [row('a', dead), row('b'), row('c', { ...dead, attempts: 2 })],
  tests: [row('t', { ...dead, error: 'Bad test' })],
  runs: [{ date: '2026-10-21', ...row('r', dead) }],
});

test('only dead-lettered pending rows are listed, with the server text and a label', () => {
  const items = failedItems(queues());
  assert.deepEqual(
    items.map((item) => [item.list, item.id, item.label, item.date]),
    [
      ['rows', 'a', 'Activity', '2026-10-20'],
      ['tests', 't', 'Fitness test', '2026-10-20'],
      ['runs', 'r', 'Prescribed run', '2026-10-21'],
    ],
  );
  assert.equal(itemTitle(items[0]), 'Activity — 2026-10-20');
  assert.equal(itemDetail(items[0]), 'Bad payload (5 attempts)');
  assert.equal(failedHeading(1), '1 change failed to sync');
  assert.equal(failedHeading(3), '3 changes failed to sync');
});

test('a dead-lettered row is not counted as waiting to upload', () => {
  assert.equal(waitingCount(queues()), 2);
  assert.equal(waitingCount({ rows: [], tests: [], runs: [] }), 0);
});

test('retry clears the refusals on that row only', () => {
  const next = retryRow(queues(), 'rows', 'a');
  assert.equal(next.rows[0].rejected, undefined);
  assert.equal(next.rows[0].pending, true);
  assert.equal(next.tests[0].rejected!.attempts, 5);
  assert.equal(next.rows[2].rejected!.attempts, 2);
});

test('retry ignores a row that is not dead-lettered', () => {
  const next = retryRow(queues(), 'rows', 'c');
  assert.equal(next.rows[2].rejected!.attempts, 2);
});

test('discard removes that one queued row and nothing else', () => {
  const next = discardRow(queues(), 'tests', 't');
  assert.equal(next.tests.length, 0);
  assert.equal(next.rows.length, 3);
  assert.equal(next.runs.length, 1);
  assert.equal(discardRow(queues(), 'rows', 'b').rows.length, 3);
});

test('the retry notice says synced, still failing or saved on the phone', () => {
  const items = [
    { list: 'rows' as const, id: 'a' },
    { list: 'tests' as const, id: 't' },
  ];
  const synced = {
    rows: [{ ...row('a'), pending: false }],
    tests: [],
    runs: [],
  };
  assert.equal(retryNotice(items, synced), 'Synced');
  const mixed = {
    rows: [row('a', { ...dead, attempts: 1 })],
    tests: [],
    runs: [],
  };
  assert.equal(retryNotice(items, mixed), '1 synced, 1 still failing');
  const failing = {
    rows: mixed.rows,
    tests: [row('t', dead)],
    runs: [],
  };
  assert.equal(retryNotice(items, failing), 'Still failing — see the error below');
  const offline = { rows: [row('a')], tests: [], runs: [] };
  assert.match(retryNotice([items[0]], offline), /^Saved on this phone/);
});

const id = '10000000-0000-4000-8000-000000000001';
const payload = {
  id,
  date: '2026-10-12',
  activityType: 'treadmill',
  title: 'Treadmill',
  durationMin: 20,
  startTime: '12:00',
  endTime: '12:20',
};
// A server that refuses every upload with a per-item error until `accept` is set.
function fixture() {
  const values = new Map<string, string>();
  const server = new Map<string, unknown>();
  let now = Date.parse('2026-10-12T12:00:00+10:00'),
    accept = false,
    posts = 0;
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => ({ activityLogs: [...server.values()] }),
    post: async (_: string, body: unknown) => {
      posts++;
      const change = (
        body as {
          mutations: {
            id: string;
            domain: string;
            date: string;
            payload: { id: string };
          }[];
        }
      ).mutations[0];
      if (!accept) {
        const { id, domain, date } = change;
        return {
          processed: 0,
          errors: [{ id, domain, date, error: 'Bad payload', retryable: false }],
        };
      }
      server.set(change.payload.id, {
        ...change.payload,
        distanceKm: null,
        notes: null,
      });
      return { processed: 1, errors: [] };
    },
  } as unknown as AccountConnection;
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => void values.set(key, value),
    remove: async (key: string) => void values.delete(key),
  };
  return {
    store: new ActivityStore(
      storage,
      connection,
      () => id,
      () => {},
      () => now,
    ),
    advance: (ms: number) => (now += ms),
    accept: () => (accept = true),
    posts: () => posts,
  };
}
async function deadLettered() {
  const f = fixture();
  await f.store.initialize();
  await f.store.saveRecord(payload);
  for (let attempt = 0; attempt < 6; attempt++) {
    f.advance(24 * 3_600_000);
    await f.store.sync();
  }
  assert.equal(failedItems(f.store.getSnapshot()).length, 1);
  return f;
}

test('the store sends a retried dead-lettered row again, and it uploads once accepted', async () => {
  const f = await deadLettered();
  const before = f.posts();
  await f.store.sync();
  assert.equal(f.posts(), before, 'a dead-lettered row is left alone');
  f.accept();
  await f.store.retryRejected('rows', id);
  const row = f.store.getSnapshot().rows[0];
  assert.equal(row.pending, false);
  assert.equal(row.rejected, undefined);
  assert.equal(failedItems(f.store.getSnapshot()).length, 0);
});

test('a retry the server refuses again restarts the count instead of dead-lettering at once', async () => {
  const f = await deadLettered();
  await f.store.retryRejected('rows', id);
  const row = f.store.getSnapshot().rows[0];
  assert.equal(row.rejected!.attempts, 1);
  assert.equal(failedItems(f.store.getSnapshot()).length, 0);
});

test('the store discards one dead-lettered row without any request', async () => {
  const f = await deadLettered();
  const before = f.posts();
  await f.store.discardRejected('rows', id);
  assert.equal(f.store.getSnapshot().rows.length, 0);
  assert.equal(f.posts(), before);
});
