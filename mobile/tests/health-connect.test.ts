import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthConnectImportStore } from '../src/features/health/data/HealthConnectImportStore.ts';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  healthConnectBatch,
  splitHealthConnectBatch,
  type HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import { normalizeHealthConnectRecord } from '../src/integrations/health-connect/records.ts';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
import { midnightDaysAgoInTz } from '@trainingai/shared/date-utils';
const now = Date.parse('2026-10-13T05:00:00Z');
const record: HealthConnectRecord = {
  id: 'steps-one',
  type: 'Steps',
  sourcePackage: 'com.test.watch',
  recordingMethod: 2,
  modifiedAt: '2026-10-12T03:00:00Z',
  start: '2026-10-12T02:00:00Z',
  end: '2026-10-12T03:00:00Z',
  value: 1200,
};
function fixture() {
  const saved = new Map<string, string>(),
    remote = new Map<string, HealthConnectRecord>();
  let offline = false,
    failDisk = false,
    wrongAck = false,
    expire = false,
    empty = false,
    noPermissions = false;
  let rows = [record];
  const order: string[] = [],
    uploads: unknown[] = [];
  const storage = {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (failDisk) throw new Error('Disk full');
      saved.set(key, value);
    },
    remove: async (key: string) => {
      saved.delete(key);
    },
  };
  const reader: HealthConnectReader = {
    permissions: async () => (noPermissions ? [] : ['Steps']),
    history: async () => {
      order.push('history');
      return { records: empty ? [] : rows, pageToken: null, skipped: 0 };
    },
    changes: async (_types, token) => {
      order.push(token ? 'changes' : 'cursor');
      if (expire && token) {
        expire = false;
        return {
          records: [],
          deleted: [],
          token: 'expired',
          expired: true,
          more: false,
          skipped: 0,
        };
      }
      return {
        records: [],
        deleted: [],
        token: 'cursor-1',
        expired: false,
        more: false,
        skipped: 0,
      };
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'account-one',
    timezone: 'Australia/Brisbane',
    get: async () => ({}),
    post: async (_path: string, body: unknown) => {
      uploads.push(body);
      if (offline) throw new Error('Offline');
      if ((body as { rebuild?: boolean }).rebuild)
        return {
          measurements: remote.size,
          nights: 0,
          days: remote.size ? 1 : 0,
          heartRate: 0,
          hrv: null,
          completedAt: new Date(now).toISOString(),
        };
      const batch = healthConnectBatch.parse(body);
      for (const row of batch.records) remote.set(row.id, row);
      for (const id of batch.deleted) remote.delete(id);
      return { accepted: wrongAck ? 0 : batch.records.length, deleted: batch.deleted.length };
    },
  };
  return {
    storage,
    saved,
    remote,
    reader,
    connection,
    order,
    uploads,
    make: () =>
      new HealthConnectImportStore(
        storage,
        connection,
        reader,
        () => {},
        () => now,
      ),
    offline: (value: boolean) => {
      offline = value;
    },
    failDisk: () => {
      failDisk = true;
    },
    wrongAck: () => {
      wrongAck = true;
    },
    expire: () => {
      expire = true;
    },
    empty: () => {
      empty = true;
    },
    noPermissions: () => {
      noPermissions = true;
    },
    rows: (value: HealthConnectRecord[]) => {
      rows = value;
    },
  };
}
test('Health Connect captures the change boundary before history, saves upload retries and resumes after reopening', async () => {
  const f = fixture();
  f.offline(true);
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.deepEqual(f.order.slice(0, 2), ['cursor', 'history']);
  assert.ok(store.getSnapshot().pending);
  assert.match(store.getSnapshot().error!, /Offline/);
  const disk = JSON.parse(f.saved.get('health-connect-import.v1')!);
  assert.equal(disk.queue[0].records[0].sourcePackage, record.sourcePackage);
  assert.equal(disk.records[record.id].value, undefined);
  f.offline(false);
  const reopened = f.make();
  await reopened.run(true);
  assert.equal(reopened.getSnapshot().pending, 0);
  assert.equal(f.remote.get(record.id)?.value, 1200);
});
test('a failed disk write cannot advance the history checkpoint or upload unsaved readings', async () => {
  const f = fixture();
  const store = f.make();
  await store.initialize();
  await f.storage.set(
    'health-connect-import.v1',
    JSON.stringify({
      origin: f.connection.origin,
      userId: f.connection.userId,
      enabled: true,
      from: new Date(now - 30 * 86400000).toISOString(),
      records: {},
      queue: [],
      token: null,
      permissionKey: 'Steps',
      scan: null,
      needsRebuild: false,
      skipped: 0,
      completed: null,
    }),
  );
  const reopened = f.make();
  await reopened.initialize();
  f.failDisk();
  await reopened.run(true);
  assert.equal(f.uploads.length, 0);
  assert.match(reopened.getSnapshot().error!, /Disk full/);
  const disk = JSON.parse(f.saved.get('health-connect-import.v1')!);
  assert.equal(disk.scan, null);
  assert.equal(disk.token, null);
});
test('unconfirmed server acknowledgements retain the same upload batch', async () => {
  const f = fixture();
  f.wrongAck();
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.ok(store.getSnapshot().pending);
  assert.equal(
    JSON.parse(f.saved.get('health-connect-import.v1')!).queue[0].records[0].id,
    record.id,
  );
});
test('expired cursors restart history and reconcile records missing from a completed rescan', async () => {
  const f = fixture();
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.equal(f.remote.size, 1);
  f.expire();
  await store.run(true);
  assert.ok(store.getSnapshot().pending);
  f.empty();
  await store.run(true);
  assert.equal(f.remote.size, 0);
  assert.equal(store.getSnapshot().pending, 0);
});
test('duplicate corrections coalesce and an invalid-but-seen record is not treated as deleted', async () => {
  const f = fixture();
  f.rows([record, { ...record, value: 1500, modifiedAt: '2026-10-12T03:01:00Z' }]);
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.equal(f.remote.get(record.id)?.value, 1500);
  f.expire();
  await store.run(true);
  f.reader.history = async () => ({
    records: [],
    pageToken: null,
    skipped: 1,
    seenIds: [record.id],
  });
  await store.run(true);
  assert.equal(f.remote.get(record.id)?.value, 1500);
  assert.equal(store.getSnapshot().skipped, 1);
});
test('revoked read permissions pause cached uploads instead of sending them', async () => {
  const f = fixture();
  f.offline(true);
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  const count = f.uploads.length;
  f.offline(false);
  f.noPermissions();
  await store.run(true);
  assert.equal(f.uploads.length, count);
  assert.ok(store.getSnapshot().pending);
});
test('a different-account or corrupt cache blocks changes and preserves its saved bytes', async () => {
  const f = fixture();
  await f.storage.set('health-connect-import.v1', '{corrupt');
  const store = f.make();
  await store.initialize();
  await assert.rejects(store.setEnabled(true));
  assert.equal(f.saved.get('health-connect-import.v1'), '{corrupt');
  assert.equal(f.uploads.length, 0);
});
test('native record conversion preserves Android source/method/units and rejects missing measurements', () => {
  const metadata = {
    id: 'weight',
    dataOrigin: 'com.test.scale',
    lastModifiedTime: record.modifiedAt,
    recordingMethod: 3,
    device: { model: 'Scale' },
  };
  const parsed = normalizeHealthConnectRecord(
    { metadata, time: record.end, weight: { inKilograms: 70.5 } },
    'Weight',
  );
  assert.equal(parsed?.value, 70.5);
  assert.equal(parsed?.sourcePackage, 'com.test.scale');
  assert.equal(parsed?.recordingMethod, 3);
  assert.equal(
    normalizeHealthConnectRecord({ metadata, time: record.end, weight: {} }, 'Weight'),
    null,
  );
});
test('source overlap is not double counted and RMSSD never enters the SDNN lane', () => {
  const result = projectHealthConnect(
    [
      record,
      { ...record, id: 'mirror', sourcePackage: 'com.test.phone' },
      {
        ...record,
        id: 'hrv',
        type: 'HeartRateVariabilityRmssd',
        value: 82,
        start: '2026-10-12T18:00:00Z',
        end: '2026-10-12T18:00:00Z',
      },
    ],
    'Australia/Brisbane',
    now,
  );
  assert.equal(result.daily.find((row) => row.date === '2026-10-12')?.steps, 1200);
  assert.equal(result.daily.find((row) => row.date === '2026-10-13')?.hrvMs, undefined);
  assert.equal(result.hrv?.method, 'RMSSD');
  assert.equal(projectHealthConnect([], 'Australia/Brisbane', now).daily.length, 0);
});

test('a rescan never deletes saved history outside the current permission window', async () => {
  const f = fixture();
  const old = {
    ...record,
    id: 'older',
    start: '2026-07-01T02:00:00Z',
    end: '2026-07-01T03:00:00Z',
    modifiedAt: '2026-07-01T03:00:00Z',
  };
  let extended = true;
  f.reader.hasHistoryPermission = async () => extended;
  f.reader.historyPermission = async () => {};
  f.rows([record, old]);
  const store = f.make();
  await store.initialize();
  await store.importHistory('2026-06-01T00:00:00Z');
  assert.equal(f.remote.size, 2);
  extended = false;
  f.rows([]);
  let readFrom = '';
  f.reader.history = async (_type, from) => {
    readFrom = from;
    return { records: [], pageToken: null, skipped: 0 };
  };
  await store.run(true);
  assert.equal(readFrom, new Date(now - 30 * 86400000).toISOString());
  assert.equal(f.remote.size, 1);
  assert.ok(f.remote.has(old.id));
});

test('a canceled import cannot write or upload a late native history result', async () => {
  const f = fixture();
  let resolvePage!: (value: Awaited<ReturnType<HealthConnectReader['history']>>) => void;
  f.reader.history = () =>
    new Promise((resolve) => {
      resolvePage = resolve;
    });
  const store = f.make();
  await store.setEnabled(true);
  const pending = store.run(true);
  while (!resolvePage) await new Promise((resolve) => setImmediate(resolve));
  const saved = f.saved.get('health-connect-import.v1');
  store.cancel();
  resolvePage({ records: [record], pageToken: null, skipped: 0 });
  await pending;
  assert.equal(f.saved.get('health-connect-import.v1'), saved);
  assert.equal(f.uploads.length, 0);
});

test('#2828 N3: records the server refuses one by one are settled, and the good ones land', async () => {
  const f = fixture();
  const bad = { ...record, id: 'steps-bad', value: 150 };
  f.rows([record, bad]);
  const post = f.connection.post;
  // The server of the day refuses what the phone's bundle still accepts (schema drift).
  f.connection.post = async (path: string, body: unknown) => {
    if ((body as { rebuild?: boolean }).rebuild) return post(path, body);
    f.uploads.push(body);
    const split = splitHealthConnectBatch(body)!;
    const records = split.batch.records.filter((row) => row.value !== 150);
    for (const row of records) f.remote.set(row.id, row);
    return {
      accepted: records.length,
      deleted: split.batch.deleted.length,
      deferred: [],
      rejected: split.batch.records
        .filter((row) => row.value === 150)
        .map((row) => ({ id: row.id, reason: 'Invalid Health Connect measurement' })),
    };
  };
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.equal(f.remote.get(record.id)?.value, 1200);
  assert.equal(f.remote.has(bad.id), false);
  assert.equal(store.getSnapshot().pending, 0);
  assert.equal(store.getSnapshot().skipped, 1);
});
test('#2828 N3: a batch the server refuses with a 400 is dropped instead of blocking every later upload', async () => {
  const f = fixture();
  const post = f.connection.post;
  let refuse = true;
  f.connection.post = async (path: string, body: unknown) => {
    if (refuse && !(body as { rebuild?: boolean }).rebuild) {
      f.uploads.push(body);
      throw new ApiError(400);
    }
    return post(path, body);
  };
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.equal(store.getSnapshot().pending, 0);
  assert.equal(store.getSnapshot().skipped, 1);
  assert.equal(JSON.parse(f.saved.get('health-connect-import.v1')!).queue.length, 0);
  // A later reading still uploads: nothing is left wedged at the head of the queue.
  refuse = false;
  f.rows([{ ...record, id: 'steps-two' }]);
  f.expire();
  await store.run(true);
  await store.run(true);
  assert.equal(f.remote.get('steps-two')?.value, 1200);
});
test('a server failure other than a 400 keeps the batch for retry', async () => {
  const f = fixture();
  f.connection.post = async () => {
    throw new ApiError(500);
  };
  const store = f.make();
  await store.setEnabled(true);
  await store.run(true);
  assert.ok(store.getSnapshot().pending);
  assert.equal(
    JSON.parse(f.saved.get('health-connect-import.v1')!).queue[0].records[0].id,
    record.id,
  );
});

// #3117 ─────────────────────────────────────────────────────────────────────────────────────────

const weight: HealthConnectRecord = {
  ...record,
  id: 'weight-one',
  type: 'Weight',
  sourcePackage: 'com.test.scale',
  value: 80.2,
};
const moreSteps: HealthConnectRecord = { ...record, id: 'steps-two', value: 900 };

// A store whose granted types and clock the test moves.
function revocable(f: ReturnType<typeof fixture>, start = now) {
  const clock = { at: start };
  let granted: ('Steps' | 'Weight')[] = ['Steps', 'Weight'];
  // Delegates late, so a test can still swap f.reader.history; and filters by type, as Health
  // Connect does, which the shared fixture does not.
  const reader: HealthConnectReader = {
    permissions: async () => granted,
    history: async (type, ...rest) => {
      const page = await f.reader.history(type, ...rest);
      return { ...page, records: page.records.filter((row) => row.type === type) };
    },
    changes: (...args) => f.reader.changes(...args),
  };
  const store = new HealthConnectImportStore(
    f.storage,
    f.connection,
    reader,
    () => {},
    () => clock.at,
  );
  return {
    store,
    clock,
    grant: (types: ('Steps' | 'Weight')[]) => {
      granted = types;
    },
  };
}
const uploadedIds = (f: ReturnType<typeof fixture>) =>
  f.uploads.flatMap((body) =>
    (body as { records?: HealthConnectRecord[] }).records?.map((row) => row.id) ?? [],
  );

// A saved import whose queue starts with a batch holding both types, then a Steps-only batch.
async function seedQueue(f: ReturnType<typeof fixture>) {
  await f.storage.set(
    'health-connect-import.v1',
    JSON.stringify({
      origin: f.connection.origin,
      userId: f.connection.userId,
      enabled: true,
      from: '2026-09-12T14:00:00.000Z',
      records: {},
      queue: [
        { records: [record, weight], deleted: [] },
        { records: [moreSteps], deleted: [] },
      ],
      token: 'cursor-1',
      tokenAt: new Date(now).toISOString(),
      permissionKey: 'Steps,Weight',
      scan: null,
      needsRebuild: false,
      skipped: 0,
      completed: null,
    }),
  );
}

test('a revoked type in the head batch no longer blocks the queue: the rest uploads, its records wait', async () => {
  const f = fixture();
  await seedQueue(f);
  const r = revocable(f);
  // Weight is turned off in Health Connect.
  r.grant(['Steps']);
  await r.store.run(true);
  assert.ok(f.remote.has(record.id), 'the allowed part of the head batch uploads');
  assert.ok(f.remote.has(moreSteps.id), 'the batch behind it uploads too');
  assert.ok(!uploadedIds(f).includes(weight.id), 'the revoked type is never sent');
  assert.equal(
    r.store.getSnapshot().error,
    'Restore the relevant Health Connect permissions to upload saved records.',
  );
  assert.equal(r.store.getSnapshot().skipped, 0);
  // Later runs keep uploading new allowed records; the held one still waits.
  await r.store.run(true);
  assert.ok(!uploadedIds(f).includes(weight.id));
  // The permission comes back: the held record goes, and the notice clears.
  r.grant(['Steps', 'Weight']);
  await r.store.run(true);
  assert.ok(f.remote.has(weight.id));
  assert.equal(r.store.getSnapshot().error, null);
});

test('records held for a revoked type are dropped and counted as skipped after 30 days', async () => {
  const f = fixture();
  await seedQueue(f);
  const r = revocable(f);
  r.grant(['Steps']);
  await r.store.run(true);
  r.clock.at += 29 * 86400000;
  await r.store.run(true);
  assert.equal(r.store.getSnapshot().skipped, 0, 'still waiting at 29 days');
  r.clock.at += 2 * 86400000;
  await r.store.run(true);
  assert.equal(r.store.getSnapshot().skipped, 1);
  assert.equal(r.store.getSnapshot().error, null, 'nothing is waiting any more');
  r.grant(['Steps', 'Weight']);
  f.rows([]);
  await r.store.run(true);
  assert.ok(!uploadedIds(f).includes(weight.id), 'a dropped record is not resurrected');
});

test('an expired change token rescans from a week before the last good read, not only 30 days', async () => {
  const f = fixture();
  const r = revocable(f);
  r.grant(['Steps']);
  await r.store.setEnabled(true);
  await r.store.run(true);
  const lastGood = r.clock.at;
  // Six weeks without a sync: the token has expired.
  r.clock.at += 45 * 86400000;
  f.expire();
  await r.store.run(true);
  let readFrom = '';
  f.reader.history = async (_type, from) => {
    readFrom = from;
    return { records: [], pageToken: null, skipped: 0 };
  };
  await r.store.run(true);
  const expected = midnightDaysAgoInTz('Australia/Brisbane', 7, new Date(lastGood)).toISOString();
  assert.equal(readFrom, expected);
  assert.ok(Date.parse(readFrom) < r.clock.at - 30 * 86400000, 'reaches past the old 30-day rescan');
});

test('the rescan never asks for more than Health Connect allows without the history permission', async () => {
  const f = fixture();
  const r = revocable(f);
  r.grant(['Steps']);
  await r.store.setEnabled(true);
  await r.store.run(true);
  const grantedAt = r.clock.at;
  // The last good read was the first one, so a week before it is past the grant's 30-day floor
  // only if the floor is ignored. Push the clock and expire to rescan.
  r.clock.at += 3 * 86400000;
  f.expire();
  await r.store.run(true);
  let readFrom = '';
  f.reader.history = async (_type, from) => {
    readFrom = from;
    return { records: [], pageToken: null, skipped: 0 };
  };
  await r.store.run(true);
  assert.ok(Date.parse(readFrom) >= grantedAt - 30 * 86400000);
});
