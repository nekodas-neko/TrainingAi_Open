import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthConnectImportStore } from '../src/features/health/data/HealthConnectImportStore.ts';
import {
  healthConnectBatch,
  type HealthConnectRecord,
} from '@trainingai/shared/validation/health-connect-import';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import { normalizeHealthConnectRecord } from '../src/integrations/health-connect/records.ts';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
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
