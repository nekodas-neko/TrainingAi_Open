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
import { readFileSync } from 'node:fs';
import { todayInTz } from '@trainingai/shared/date-utils';
import type { FirstHandSources } from '@trainingai/shared/health/health-connect-origin';
import { loadFirstHandSources } from '../src/features/health/data/first-hand-sources.ts';
import { readinessSpec } from '../src/features/health/data/models.ts';
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
function fixture(
  sources: FirstHandSources | null,
  rows: HealthConnectRecord[],
  over: Partial<HealthConnectReader> = {},
) {
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
    ...over,
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
test('with a per-type answer, only the types Oura Cloud delivers are skipped (#3204)', async () => {
  const f = fixture(
    { ouraCloud: false, ouraCloudTypes: { SleepSession: true, HeartRate: true, Steps: false } },
    healthConnectTypes.map((type) => row(type, OURA)),
  );
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.remote.size, healthConnectTypes.length - 2);
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, { SleepSession: 1, HeartRate: 1 });
});
test('the per-type answer is read from the payload next to the boolean (#3204)', async () => {
  const resources = (data: unknown) => ({
    load: async () => {},
    state: () => ({ data: data as { connectedSources?: unknown } | null }),
  });
  const ouraCloudTypes = { SleepSession: true, OxygenSaturation: false };
  assert.deepEqual(
    await loadFirstHandSources(resources({ connectedSources: { ouraCloud: false, ouraCloudTypes } }), 'UTC'),
    { ouraCloud: false, ouraCloudTypes },
  );
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
test('a record is skipped on every path it can arrive by: first read, scan page and change page', async () => {
  const oura = healthConnectTypes.map((type) => row(type, OURA));
  const change = (records: HealthConnectRecord[]) => ({
    records,
    deleted: [],
    token: 'cursor-2',
    expired: false,
    more: false,
    skipped: 0,
  });
  // The first read, the scan pages (the fixture's `history`) and the later change pages all return
  // the Oura rows.
  const f = fixture({ ouraCloud: true }, oura, { changes: async () => change(oura) });
  await f.store.setEnabled(true);
  await f.store.run(true);
  await f.store.run(true);
  assert.equal(f.remote.size, 0);
  // Per sync: the second run counts what it saw, not the first run's too.
  assert.deepEqual(
    f.store.getSnapshot().skippedFirstHand,
    Object.fromEntries(healthConnectTypes.map((type) => [type, 1])),
  );
});
test("counts are per sync: a rescan does not count the same record again", async () => {
  const f = fixture({ ouraCloud: true }, [row('SleepSession', OURA)]);
  await f.store.setEnabled(true);
  await f.store.run(true);
  await f.store.importHistory('2026-10-01T00:00:00Z');
  await f.store.importHistory('2026-10-01T00:00:00Z');
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, { SleepSession: 1 });
  // A sync that leaves nothing out reports nothing, not the last sync's count.
  f.connect({ ouraCloud: false });
  await f.store.run(true);
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, {});
});
test('records skipped while connected are read again once Oura Cloud reads as disconnected', async () => {
  const f = fixture({ ouraCloud: true }, [row('SleepSession', OURA)]);
  await f.store.setEnabled(true);
  await f.store.run(true);
  assert.equal(f.remote.size, 0);
  // Not known: keeps the skip state and uploads nothing new.
  f.connect(null);
  await f.store.run(true);
  f.connect({ ouraCloud: false });
  await f.store.run(true);
  assert.equal(f.remote.size, 1);
  assert.deepEqual(f.store.getSnapshot().skippedFirstHand, {});
});
test('the connection is read from today\'s readiness payload by the one cold-start rule', async () => {
  const today = todayInTz('UTC');
  const resources = (data: unknown, fail = false) => ({
    load: async () => {
      if (fail) throw new Error('offline');
    },
    state: () => ({ data: data as { connectedSources?: unknown } | null }),
  });
  assert.deepEqual(
    await loadFirstHandSources(resources({ connectedSources: { ouraCloud: true } }), 'UTC'),
    { ouraCloud: true },
  );
  assert.deepEqual(
    await loadFirstHandSources(resources({ connectedSources: { ouraCloud: false } }), 'UTC'),
    { ouraCloud: false },
  );
  // Unknown: no resources, nothing loaded yet, a field that is not a boolean.
  assert.equal(await loadFirstHandSources(null, 'UTC'), null);
  assert.equal(await loadFirstHandSources(resources(null), 'UTC'), null);
  assert.equal(await loadFirstHandSources(resources({}), 'UTC'), null);
  assert.equal(
    await loadFirstHandSources(resources({ connectedSources: { ouraCloud: 'yes' } }), 'UTC'),
    null,
  );
  assert.equal(readinessSpec(today).partition, today);
});
test('the hook gives the store the connection lookup', () => {
  const hook = readFileSync(
    new URL('../src/features/health/useDeviceHealthImport.android.ts', import.meta.url),
    'utf8',
  );
  assert.match(hook, /from '\.\/data\/first-hand-sources'/);
  assert.match(hook, /new HealthConnectImportStore\([\s\S]*?loadFirstHandSources\(resources, dataReader\.timezone\)/);
});
