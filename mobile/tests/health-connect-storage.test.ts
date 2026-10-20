import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HealthConnectRecord } from '@trainingai/shared/validation/health-connect-import';
import { createLocalStorage, type ScopedStorage } from '../src/core/storage/LocalStorage.ts';
import {
  HealthConnectPersistence,
  type HealthConnectSaved,
} from '../src/features/health/data/health-connect-persistence.ts';
import { HealthConnectImportStore } from '../src/features/health/data/HealthConnectImportStore.ts';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
import { sqliteFixture } from './storage-fixture.ts';

// #3121: the import's cache, queue and held records live in their own entries.

const now = Date.parse('2026-10-20T00:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();
const row = (id: string, startMs: number, type: HealthConnectRecord['type'] = 'Steps') => ({
  id,
  type,
  sourcePackage: 'com.test.watch',
  recordingMethod: 2,
  modifiedAt: at(startMs + 60_000),
  start: at(startMs),
  end: at(startMs + 60_000),
  value: 120,
});
const cacheOf = (rows: ReturnType<typeof row>[]) =>
  Object.fromEntries(
    rows.map((r) => [r.id, { id: r.id, type: r.type, start: r.start, modifiedAt: r.modifiedAt }]),
  );

// An import saved in the old single value: three weeks of step records in the cache, three batches
// queued, one held for a revoked Weight permission, and a scan part-way through its pages.
function legacy() {
  const rows = Array.from({ length: 21 * 4 }, (_, i) =>
    row(`hr-${i}`, now - 21 * DAY + Math.floor(i / 4) * DAY + (i % 4) * 3_600_000),
  );
  return {
    origin: 'https://example.com',
    userId: 'account-one',
    enabled: true,
    from: at(now - 30 * DAY),
    records: cacheOf(rows),
    queue: [
      { records: rows.slice(0, 3), deleted: [] },
      { records: [], deleted: ['gone-1', 'gone-2'] },
      { rebuild: true },
    ],
    token: 'token-7',
    tokenAt: at(now - DAY),
    rescanFrom: null,
    grantedAt: at(now - 60 * DAY),
    blocked: [
      {
        batch: { records: [row('weight-1', now - 2 * DAY, 'Weight')], deleted: [] },
        since: at(now - DAY),
      },
    ],
    permissionKey: 'HeartRate,Steps',
    scan: {
      types: ['HeartRate', 'Steps'],
      index: 1,
      pageToken: 'page-3',
      from: at(now - 30 * DAY),
      end: at(now - 3_600_000),
      oldIds: rows.slice(0, 40).map((r) => r.id),
      seen: rows.slice(0, 25).map((r) => r.id),
      token: 'token-8',
    },
    needsRebuild: true,
    skipped: 2,
    completed: null,
  };
}

// A map-backed storage with no transaction, which can be told to stop after `limit` operations,
// as a process killed mid-write would.
function killable(saved = new Map<string, string>()) {
  let limit = Infinity;
  let operations = 0;
  const step = () => {
    if (operations++ >= limit) throw new Error('killed');
  };
  const storage: ScopedStorage = {
    get: async (key) => saved.get(key) ?? null,
    set: async (key, value) => {
      step();
      saved.set(key, value);
    },
    remove: async (key) => {
      step();
      saved.delete(key);
    },
    keys: async (prefix) => [...saved.keys()].filter((key) => key.startsWith(prefix)),
  };
  return {
    saved,
    storage,
    killAfter: (n: number) => {
      limit = n;
      operations = 0;
    },
    operations: () => operations,
  };
}

async function open(storage: ScopedStorage) {
  const persistence = new HealthConnectPersistence(storage);
  const saved = (await persistence.read()) as HealthConnectSaved | null;
  return { persistence, saved };
}

test('the old single value moves into its own entries, and a kill at any point finishes on the next open', async () => {
  const original = legacy();
  // How many operations an uninterrupted move takes.
  const whole = killable(new Map([['health-connect-import.v1', JSON.stringify(original)]]));
  const first = await open(whole.storage);
  await first.persistence.opened(first.saved!);
  const total = whole.operations();
  assert.ok(total > 5, `the move writes several entries (${total})`);
  assert.ok(!whole.saved.has('health-connect-import.v1'), 'the old value is removed');
  for (let k = 0; k < total; k++) {
    const f = killable(new Map([['health-connect-import.v1', JSON.stringify(original)]]));
    f.killAfter(k);
    const killed = await open(f.storage);
    assert.deepEqual(killed.saved, original);
    await assert.rejects(killed.persistence.opened(killed.saved!), /killed/);
    // Reopened: whatever landed, the import reads back exactly as it was saved.
    f.killAfter(Infinity);
    const reopened = await open(f.storage);
    assert.deepEqual(reopened.saved, original, `kill after ${k} operations`);
    await reopened.persistence.opened(reopened.saved!);
    const final = await open(f.storage);
    assert.deepEqual(final.saved, original);
    assert.ok(!f.saved.has('health-connect-import.v1'), `old value gone after kill at ${k}`);
    // Nothing is left behind: the entries on disk are exactly those of an uninterrupted move.
    assert.deepEqual([...f.saved.keys()].sort(), [...whole.saved.keys()].sort());
  }
});

test('the token, the scan cursor and the held records come through the move unchanged', async () => {
  const original = legacy();
  const f = killable(new Map([['health-connect-import.v1', JSON.stringify(original)]]));
  const first = await open(f.storage);
  await first.persistence.opened(first.saved!);
  const { saved } = await open(f.storage);
  assert.equal(saved!.token, 'token-7');
  assert.equal(saved!.tokenAt, original.tokenAt);
  assert.deepEqual(
    [saved!.scan!.pageToken, saved!.scan!.index, saved!.scan!.token],
    ['page-3', 1, 'token-8'],
  );
  assert.deepEqual(saved!.scan!.seen, original.scan.seen);
  assert.deepEqual(saved!.scan!.oldIds, original.scan.oldIds);
  assert.deepEqual(saved!.blocked, original.blocked);
  assert.deepEqual(saved!.queue, original.queue);
});

test('after the move, a write touches only the entries that changed', async () => {
  const db = sqliteFixture();
  const local = await createLocalStorage(db.database);
  const scoped = local.account('https://example.com', 'account-one');
  let written: [string, string | null][] = [];
  const counting: ScopedStorage = {
    ...scoped,
    setMany: async (entries) => {
      written = entries;
      await scoped.setMany!(entries);
    },
  };
  await scoped.set('health-connect-import.v1', JSON.stringify(legacy()));
  const { persistence, saved } = await open(counting);
  await persistence.opened(saved!);
  const disk = saved!;
  const keys = () => written.map(([key, value]) => `${value === null ? '-' : '+'}${key}`);

  // Nothing changed: nothing is written.
  assert.equal(await persistence.write({ ...disk }), 0);

  // One page: a new step record on yesterday, its batch queued, the page's ids seen.
  const fresh = row('hr-new', now - DAY + 30 * 60_000);
  const page: HealthConnectSaved = {
    ...disk,
    records: { ...disk.records, ...cacheOf([fresh]) },
    queue: [...disk.queue, { records: [fresh], deleted: [] }],
    scan: { ...disk.scan!, seen: [...disk.scan!.seen, fresh.id], pageToken: 'page-4' },
  };
  await persistence.write(page);
  assert.deepEqual(keys().sort(), [
    `+health-connect-ids.v1:${fresh.start.slice(0, 10)}`,
    '+health-connect-import.v2',
    '+health-connect-queue.v1:000000004',
    '+health-connect-seen.v1:000000001',
  ]);

  // The head batch uploads: its entry goes and the core is rewritten; the cache, the other
  // batches and the held record are not touched.
  const sent = { ...page, queue: page.queue.slice(1) };
  await persistence.write(sent);
  assert.deepEqual(keys().sort(), ['+health-connect-import.v2', '-health-connect-queue.v1:000000000']);

  // A deferred batch rotated to the back moves in the core's index only.
  await persistence.write({ ...sent, queue: [...sent.queue.slice(1), sent.queue[0]] });
  assert.deepEqual(keys(), ['+health-connect-import.v2']);

  // The scan finishes: its id snapshot and pages go.
  await persistence.write({ ...sent, scan: null });
  assert.deepEqual(keys().sort(), [
    '+health-connect-import.v2',
    '-health-connect-scan-ids.v1',
    '-health-connect-seen.v1:000000000',
    '-health-connect-seen.v1:000000001',
  ]);

  // And it all reads back.
  const reread = await open(scoped);
  assert.deepEqual(reread.saved!.blocked, disk.blocked);
  assert.equal(reread.saved!.queue.length, 3);
  assert.equal(Object.keys(reread.saved!.records).length, Object.keys(page.records).length);
});

test('reopened from the new entries, a write still points at batches that are there', async () => {
  const f = killable(new Map([['health-connect-import.v1', JSON.stringify(legacy())]]));
  const first = await open(f.storage);
  await first.persistence.opened(first.saved!);
  // A second launch: read the entries, then change something small.
  const second = await open(f.storage);
  await second.persistence.opened(second.saved!);
  const before = new Map(f.saved);
  await second.persistence.write({ ...second.saved!, skipped: 3 });
  const changed = [...f.saved].filter(([key, value]) => before.get(key) !== value).map(([key]) => key);
  assert.deepEqual(changed, ['health-connect-import.v2'], 'only the core record changes');
  const third = await open(f.storage);
  assert.equal(third.saved!.skipped, 3);
  assert.deepEqual(third.saved!.queue, legacy().queue);
  assert.deepEqual(third.saved!.blocked, legacy().blocked);
});

test('an entry the core lists but storage lacks refuses to open rather than drop a batch', async () => {
  const f = killable(new Map([['health-connect-import.v1', JSON.stringify(legacy())]]));
  const first = await open(f.storage);
  await first.persistence.opened(first.saved!);
  f.saved.delete('health-connect-queue.v1:000000001');
  await assert.rejects(open(f.storage), /health-connect-queue\.v1:000000001 is missing/);
});

// The store, end to end: a cached id older than any rescan can reach is dropped, unless its
// record is still queued or held.
test('the record-id cache is pruned below the oldest rescan, keeping anything queued or held', async () => {
  const f = killable();
  const old = row('old', now - 120 * DAY);
  const oldQueued = row('old-queued', now - 120 * DAY + 60_000);
  const oldHeld = row('old-held', now - 120 * DAY + 120_000, 'Weight');
  const recent = row('recent', now - 2 * DAY);
  const original = {
    ...legacy(),
    from: at(now - 365 * DAY),
    grantedAt: at(now - 60 * DAY),
    records: cacheOf([old, oldQueued, oldHeld, recent]),
    queue: [{ records: [oldQueued], deleted: [] }],
    blocked: [{ batch: { records: [oldHeld], deleted: [] }, since: at(now - DAY) }],
    scan: null,
    permissionKey: 'Steps',
  };
  f.saved.set('health-connect-import.v1', JSON.stringify(original));
  const reader: HealthConnectReader = {
    permissions: async () => ['Steps'],
    history: async () => ({ records: [], pageToken: null, skipped: 0 }),
    changes: async () => ({
      records: [],
      deleted: [],
      token: 'token-8',
      expired: false,
      more: false,
      skipped: 0,
    }),
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    // Offline, so the queue stays as it is.
    post: async () => {
      throw new Error('Offline');
    },
  };
  const store = new HealthConnectImportStore(f.storage, connection, reader, () => {}, () => now);
  await store.run(true);
  assert.equal(store.getSnapshot().ready, true);
  const { saved } = await open(f.storage);
  // Without the history permission no rescan reads before 30 days before the first grant.
  assert.deepEqual(Object.keys(saved!.records).sort(), ['old-held', 'old-queued', 'recent']);
  assert.equal(saved!.token, 'token-7', 'the change token is untouched by the prune');
});

// #3143 ─────────────────────────────────────────────────────────────────────────────────────────

// A phone that syncs once a day for 150 days, each day bringing 20 new step records through the
// change token, against a server that accepts everything.
async function dailySyncs(days: number, perDay: number) {
  const f = killable();
  const clock = { at: now };
  let n = 0;
  const reader: HealthConnectReader = {
    permissions: async () => ['Steps'],
    history: async () => ({ records: [], pageToken: null, skipped: 0 }),
    changes: async (_types, token) => ({
      records: token
        ? Array.from({ length: perDay }, () => row(`steps-${n++}`, clock.at - 2 * 3_600_000))
        : [],
      deleted: [],
      token: `token-${clock.at}`,
      expired: false,
      more: false,
      skipped: 0,
    }),
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async (_path: string, body: unknown) => {
      const batch = body as { rebuild?: boolean; records?: unknown[]; deleted?: unknown[] };
      if (batch.rebuild)
        return { measurements: 0, nights: 0, days: 0, heartRate: 0, hrv: null, completedAt: at(clock.at) };
      return { accepted: batch.records?.length ?? 0, deleted: batch.deleted?.length ?? 0 };
    },
  };
  const store = new HealthConnectImportStore(f.storage, connection, reader, () => {}, () => clock.at);
  await store.setEnabled(true);
  for (let day = 0; day < days; day++) {
    clock.at = now + day * DAY;
    await store.run(true);
  }
  return { f, store, clock };
}

test('150 daily syncs keep about the rescan window of ids, not every id since the grant', async () => {
  const { f, store } = await dailySyncs(150, 20);
  assert.equal(store.getSnapshot().error, null);
  const { saved } = await open(f.storage);
  const kept = Object.keys(saved!.records).length;
  // 3,000 ids were seen; the floor is now − 30 days, so about 30 days of 20 a day remain.
  assert.ok(kept >= 29 * 20 && kept <= 32 * 20, `kept ${kept} of 3000`);
  const oldest = Math.min(...Object.values(saved!.records).map((r) => Date.parse(r.start)));
  assert.ok(oldest >= now + 149 * DAY - 31 * DAY, 'nothing older than the window is left');
  // And each open now reads about a month of day entries, not five.
  const dayEntries = [...f.saved.keys()].filter((key) => key.startsWith('health-connect-ids.v1:'));
  assert.ok(dayEntries.length <= 32, `${dayEntries.length} day entries`);
});

test('a held id older than the floor survives the prune, and so does a queued one', async () => {
  const f = killable();
  const clock = now + 120 * DAY;
  const heldOld = row('held-old', clock - 90 * DAY, 'Weight');
  const queuedOld = row('queued-old', clock - 90 * DAY + 60_000);
  const plainOld = row('plain-old', clock - 90 * DAY + 120_000);
  const recent = row('recent', clock - DAY);
  f.saved.set(
    'health-connect-import.v1',
    JSON.stringify({
      ...legacy(),
      from: at(now - 365 * DAY),
      grantedAt: at(now - 60 * DAY),
      token: 'token-9',
      tokenAt: at(clock - 3_600_000),
      records: cacheOf([heldOld, queuedOld, plainOld, recent]),
      queue: [{ records: [queuedOld], deleted: [] }],
      blocked: [{ batch: { records: [heldOld], deleted: [] }, since: at(clock - DAY) }],
      scan: null,
      permissionKey: 'Steps',
    }),
  );
  const reader: HealthConnectReader = {
    permissions: async () => ['Steps'],
    history: async () => ({ records: [], pageToken: null, skipped: 0 }),
    changes: async () => ({ records: [], deleted: [], token: 'token-10', expired: false, more: false, skipped: 0 }),
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async () => {
      throw new Error('Offline');
    },
  };
  const store = new HealthConnectImportStore(f.storage, connection, reader, () => {}, () => clock);
  await store.run(true);
  const { saved } = await open(f.storage);
  // The floor is now − 30 days, past the grant's: the plain 90-day-old id goes, the others stay.
  assert.deepEqual(Object.keys(saved!.records).sort(), ['held-old', 'queued-old', 'recent']);
});
