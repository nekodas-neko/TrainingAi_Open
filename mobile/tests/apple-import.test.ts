import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppleHealthImportStore } from '../src/features/health/data/AppleHealthImportStore.ts';
import {
  appleImportBatch,
  type AppleImportBatch,
} from '@trainingai/shared/validation/apple-health-import';
import { projectAppleHealth } from '@trainingai/shared/health/apple-health-projection';
import { createApiClient } from '../src/features/account/api/client.ts';
const now = Date.parse('2026-10-12T04:00:00Z');
const type = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sample = {
  id: id(1),
  start: '2026-10-11T12:00:00Z',
  end: '2026-10-11T20:00:00Z',
  value: 1,
  sourceName: 'Example watch',
  sourceBundleId: 'example.watch',
};
function fixture() {
  const disk = new Map<string, string>();
  let online = true,
    lost = false,
    failDisk = false,
    changed = 0;
  const seen = new Set<string>();
  const requests: unknown[] = [];
  const anchors: (string | undefined)[] = [];
  const storage = {
    get: async (key: string) =>
      disk.get(key) ??
      (key === 'apple-health-import.v1'
        ? JSON.stringify({
            origin: 'https://example.com',
            userId: 'one',
            enabled: true,
            from: new Date(now - 7 * 86400000).toISOString(),
            anchors: {},
            queue: [],
            completed: null,
            skipped: 0,
            needsRebuild: false,
            historyFrom: null,
          })
        : null),
    set: async (key: string, value: string) => {
      if (failDisk) {
        throw new Error('disk full');
      }
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const connection = {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => null,
    post: async (_path: string, body: unknown) => {
      requests.push(body);
      if (!online) {
        throw new Error('offline');
      }
      if ((body as { rebuild?: boolean }).rebuild) {
        return {
          measurements: seen.size,
          nights: 1,
          days: 1,
          heartRate: 0,
          hrv: null,
          completedAt: new Date(now).toISOString(),
        };
      }
      const batch = appleImportBatch.parse(body);
      for (const row of batch.samples) {
        seen.add(row.id);
      }
      for (const id of batch.deleted) {
        seen.delete(id);
      }
      if (lost) {
        lost = false;
        throw new Error('reply lost');
      }
      return { accepted: batch.samples.length, deleted: batch.deleted.length };
    },
  };
  const reader = async (kind: string, _from: string, anchor?: string) => {
    if (kind !== type) {
      return null;
    }
    anchors.push(anchor);
    return {
      samples: anchor ? [] : [sample],
      deleted: [],
      anchor: 'next',
      more: false,
      skipped: 0,
    };
  };
  const make = () =>
    new AppleHealthImportStore(
      storage,
      connection,
      reader,
      () => {
        changed++;
      },
      () => now,
    );
  return {
    disk,
    storage,
    connection,
    reader,
    make,
    requests,
    anchors,
    seen,
    changed: () => changed,
    online: (value: boolean) => {
      online = value;
    },
    lost: () => {
      lost = true;
    },
    failDisk: () => {
      failDisk = true;
    },
  };
}
test('health import checkpoints and uploads survive offline reopening without skipping samples', async () => {
  const f = fixture();
  f.online(false);
  const first = f.make();
  await first.run(true);
  assert.equal(first.getSnapshot().pending, 2);
  const saved = JSON.parse(f.disk.get('apple-health-import.v1')!);
  assert.equal(saved.anchors[type], 'next');
  assert.equal(saved.queue[0].samples[0].id, sample.id);
  first.cancel();
  f.online(true);
  const next = f.make();
  await next.run(true);
  assert.equal(next.getSnapshot().pending, 0);
  assert.equal(f.seen.size, 1);
  assert.equal(f.anchors.at(-1), 'next');
  assert.equal(f.changed(), 1);
});
test('lost upload acknowledgement repeats the same IDs and only marks results synced after projection', async () => {
  const f = fixture();
  f.lost();
  const store = f.make();
  await store.run(true);
  assert.equal(store.getSnapshot().completed, null);
  assert.equal(f.seen.size, 1);
  await store.run(true);
  assert.equal(store.getSnapshot().completed?.measurements, 1);
  assert.equal(f.seen.size, 1);
  assert.equal(
    (f.requests[0] as AppleImportBatch).samples[0].id,
    (f.requests[1] as AppleImportBatch).samples[0].id,
  );
});
test('disk failure cannot advance a HealthKit checkpoint or upload unpersisted records', async () => {
  const f = fixture();
  f.failDisk();
  const store = f.make();
  await store.run(true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.disk.size, 0);
  assert.equal(store.getSnapshot().pending, 0);
  assert.ok(store.getSnapshot().error);
});
test('a canceled import cannot enqueue late records or read another account cache', async () => {
  const f = fixture();
  let resolve!: (value: Awaited<ReturnType<typeof f.reader>>) => void;
  const store = new AppleHealthImportStore(
    f.storage,
    f.connection,
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
    () => {},
    () => now,
  );
  const running = store.run(true);
  await new Promise((r) => setImmediate(r));
  store.cancel();
  resolve({ samples: [sample], deleted: [], anchor: 'late', more: false, skipped: 0 });
  await running;
  assert.equal(f.disk.size, 0);
  assert.equal(f.requests.length, 0);
  await f.make().run(true);
  const other = new AppleHealthImportStore(
    f.storage,
    { ...f.connection, userId: 'two' },
    f.reader,
    () => {},
    () => now,
  );
  await other.run(true);
  assert.equal(other.getSnapshot().ready, false);
  assert.ok(other.getSnapshot().error);
});
test('sleep and movement summaries avoid overlapping-source totals and keep SDNN separate', () => {
  const rows = [
    { ...sample, type },
    { ...sample, id: id(2), type: 'HKQuantityTypeIdentifierStepCount' as const, value: 100 },
    {
      ...sample,
      id: id(3),
      type: 'HKQuantityTypeIdentifierStepCount' as const,
      value: 100,
      deviceName: 'Other watch',
    },
    {
      ...sample,
      id: id(4),
      type: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' as const,
      value: 82,
    },
    {
      ...sample,
      id: id(5),
      type: 'HKQuantityTypeIdentifierRestingHeartRate' as const,
      value: 55,
    },
  ];
  const projection = projectAppleHealth(rows, 'Australia/Brisbane', now);
  assert.equal(projection.sleep[0].durationHours, 8);
  assert.equal(
    projection.daily.reduce((sum, day) => sum + (day.steps ?? 0), 0),
    100,
  );
  assert.equal(projection.hrv?.method, 'SDNN');
  assert.equal('hrvMs' in projection.daily[0], false);
  assert.equal(projection.daily[0].restingHeartRate, 55);
});
test('rebuild after source deletion removes its contribution without fabricating an empty measurement', () => {
  const before = projectAppleHealth([{ ...sample, type }], 'Australia/Brisbane', now);
  const after = projectAppleHealth([], 'Australia/Brisbane', now);
  assert.equal(before.sleep.length, 1);
  assert.equal(after.sleep.length, 0);
  assert.equal(after.daily.length, 0);
  assert.equal(after.hrv, null);
});
test('import rejects inconsistent types, identities and intervals before storage', () => {
  assert.equal(
    appleImportBatch.safeParse({ type, samples: [sample], deleted: [sample.id] }).success,
    false,
  );
  assert.equal(
    appleImportBatch.safeParse({ type, samples: [{ ...sample, value: 3.5 }], deleted: [] })
      .success,
    false,
  );
  assert.equal(
    appleImportBatch.safeParse({
      type,
      samples: [{ ...sample, end: '2026-10-11T11:00:00Z' }],
      deleted: [],
    }).success,
    false,
  );
});
test('account export streams authenticated chunks and rejects HTML and missing sessions', async () => {
  const chunks: Uint8Array[] = [];
  let sent: RequestInit | undefined;
  const api = createApiClient(
    'https://example.com',
    async () => 'token',
    async (_input, init) => {
      sent = init;
      return new Response('{"table":"workouts"}\n{"_complete":true}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    },
  );
  await api.streamExport(async (bytes) => {
    chunks.push(bytes);
  });
  assert.match(new TextDecoder().decode(Buffer.concat(chunks)), /_complete/);
  assert.equal((sent?.headers as Record<string, string>).Authorization, 'Bearer token');
  assert.equal(sent?.redirect, 'error');
  await assert.rejects(
    createApiClient('https://example.com', async () => null).streamExport(async () => {}),
    /Sign in/,
  );
  await assert.rejects(
    createApiClient(
      'https://example.com',
      async () => 'token',
      async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    ).streamExport(async () => {}),
    /data export/,
  );
});
