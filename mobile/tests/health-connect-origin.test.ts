import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthConnectImportStore } from '../src/features/health/data/HealthConnectImportStore.ts';
import {
  healthConnectBatch,
  healthConnectTypes,
  type HealthConnectRecord,
  type HealthConnectType,
} from '@trainingai/shared/validation/health-connect-import';
import type { HealthConnectReader } from '../src/integrations/health-connect/types.ts';
import type { FirstHandSources } from '@trainingai/shared/health/health-connect-origin';
// #3115 part 2: with Oura Cloud connected, Preview does not import the Oura app's own records.
const now = Date.parse('2026-10-13T05:00:00Z');
const OURA = 'com.ouraring.oura';
function row(type: HealthConnectType, sourcePackage: string): HealthConnectRecord {
  const base = {
    id: `${type}-${sourcePackage}`,
    type,
    sourcePackage,
    recordingMethod: 2,
    modifiedAt: '2026-10-12T07:00:00Z',
    start: '2026-10-11T22:00:00Z',
    end: '2026-10-12T06:00:00Z',
  };
  if (type === 'HeartRate') return { ...base, points: [{ at: '2026-10-11T22:00:00Z', bpm: 55 }] };
  if (type === 'SleepSession')
    return {
      ...base,
      stages: [{ start: '2026-10-11T22:00:00Z', end: '2026-10-12T06:00:00Z', kind: 'light' }],
    };
  return { ...base, value: type === 'Weight' ? 80 : 50 };
}
function fixture(sources: FirstHandSources | null, rows: HealthConnectRecord[]) {
  const saved = new Map<string, string>(),
    remote = new Map<string, HealthConnectRecord>();
  let current = sources;
  const reader: HealthConnectReader = {
    permissions: async () => [...healthConnectTypes],
    history: async (type) => ({
      records: rows.filter((r) => r.type === type),
      pageToken: null,
      skipped: 0,
    }),
    changes: async () => ({
      records: [],
      deleted: [],
      token: 'cursor-1',
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
      if ((body as { rebuild?: boolean }).rebuild)
        return {
          measurements: remote.size,
          nights: 0,
          days: 0,
          heartRate: 0,
          hrv: null,
          completedAt: new Date(now).toISOString(),
        };
      const batch = healthConnectBatch.parse(body);
      for (const r of batch.records) remote.set(r.id, r);
      for (const id of batch.deleted) remote.delete(id);
      return { accepted: batch.records.length, deleted: batch.deleted.length };
    },
  };
  const store = new HealthConnectImportStore(
    {
      get: async (key: string) => saved.get(key) ?? null,
      set: async (key: string, value: string) => void saved.set(key, value),
      remove: async (key: string) => void saved.delete(key),
    },
    connection,
    reader,
    () => {},
    () => now,
    async () => current,
  );
  return {
    store,
    remote,
    connect: (value: FirstHandSources | null) => {
      current = value;
    },
  };
}
test('every type the Oura app writes is skipped and counted while Oura Cloud is connected', async () => {
  const f = fixture({ ouraCloud: true }, healthConnectTypes.map((type) => row(type, OURA)));
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.remote.size, 0);
  assert.deepEqual(
    f.store.getSnapshot().skippedFirstHand,
    Object.fromEntries(healthConnectTypes.map((type) => [type, 1])),
  );
  // Counts only: the report never carries a value.
  assert.ok(Object.values(f.store.getSnapshot().skippedFirstHand).every((n) => n === 1));
});
test("without Oura Cloud, or when it is unknown, the Oura app's records still import", async () => {
  for (const sources of [{ ouraCloud: false }, null]) {
    const f = fixture(sources, healthConnectTypes.map((type) => row(type, OURA)));
    await f.store.setEnabled(true);
    await f.store.run(true);
    assert.equal(f.remote.size, healthConnectTypes.length);
    assert.deepEqual(f.store.getSnapshot().skippedFirstHand, {});
  }
});
test("another app's records are never skipped", async () => {
  const f = fixture({ ouraCloud: true }, [
    ...healthConnectTypes.map((type) => row(type, 'com.sec.android.app.shealth')),
    row('Weight', 'com.qingniu.renpho'),
    row('SleepSession', OURA),
  ]);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.remote.size, healthConnectTypes.length + 1);
  assert.ok(![...f.remote.values()].some((r) => r.sourcePackage === OURA));
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, { SleepSession: 1 });
});
test('a record imported before the connection is not deleted when a later rescan skips it', async () => {
  const f = fixture(null, [row('SleepSession', OURA)]);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.remote.size, 1);
  f.connect({ ouraCloud: true });
  await f.store.importHistory('2026-10-01T00:00:00Z');
  assert.equal(f.remote.size, 1);
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, { SleepSession: 1 });
});
