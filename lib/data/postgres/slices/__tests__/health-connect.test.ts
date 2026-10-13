import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import * as schema from '../../schema';
import { applyHealthConnectBatch, rebuildHealthConnect } from '../health-connect';
import { getNativeMovementIntervals } from '../native-movement';
import type { HealthConnectRecord } from '@trainingai/shared/validation/health-connect-import';
const user = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
const record: HealthConnectRecord = {
  id: 'weight-one',
  type: 'Weight',
  value: 72,
  sourcePackage: 'com.test.scale',
  recordingMethod: 2,
  modifiedAt: '2026-10-12T08:00:00Z',
  start: '2026-10-12T07:00:00Z',
  end: '2026-10-12T07:00:00Z',
};
let engine: PGlite;
let db: Parameters<typeof applyHealthConnectBatch>[0];
beforeAll(async () => {
  engine = new PGlite();
  await engine.exec(
    `CREATE TABLE users(id uuid PRIMARY KEY);INSERT INTO users VALUES('${user}'),('${other}');`,
  );
  await engine.exec(
    readFileSync(
      'lib/data/postgres/migrations/202610131300_health_connect_records.sql',
      'utf8',
    ),
  );
  for (const [table, unique] of [
    [schema.appleHealthSamples, 'user_id,sample_id'],
    [schema.bodyMetrics, 'user_id,date'],
    [schema.sleepSessions, 'user_id,sleep_start'],
    [schema.ouraHeartrate, 'user_id,timestamp'],
    [schema.dailyZoneMinutes, null],
    [schema.bodyBatteryDaily, null],
    [schema.ouraDailyDerived, null],
  ] as const) {
    const config = getTableConfig(table);
    const columns = config.columns
      .map(
        (column) =>
          `"${column.name}" ${column.getSQLType()}${column.name === 'id' && column.getSQLType() === 'uuid' ? ' DEFAULT gen_random_uuid()' : ''}`,
      )
      .join(',');
    await engine.exec(
      `CREATE TABLE "${config.name}"(${columns}${unique ? `,UNIQUE(${unique})` : ''});`,
    );
  }
  db = drizzle(engine, { schema }) as unknown as typeof db;
});
afterAll(async () => engine?.close());
describe('Health Connect ledger and projections', () => {
  it('preserves source metadata, corrects newer records and refuses stale data or resurrection', async () => {
    await applyHealthConnectBatch(db, user, { records: [record], deleted: [] });
    await applyHealthConnectBatch(db, user, {
      records: [{ ...record, value: 73, modifiedAt: '2026-10-12T09:00:00Z' }],
      deleted: [],
    });
    await applyHealthConnectBatch(db, user, { records: [record], deleted: [] });
    let result = await engine.query<{ record_payload: HealthConnectRecord }>(
      'SELECT record_payload FROM health_connect_records WHERE user_id=$1 AND record_id=$2',
      [user, record.id],
    );
    expect(result.rows[0].record_payload.value).toBe(73);
    expect(result.rows[0].record_payload.sourcePackage).toBe('com.test.scale');
    await applyHealthConnectBatch(db, user, { records: [], deleted: [record.id] });
    await applyHealthConnectBatch(db, user, {
      records: [{ ...record, value: 99, modifiedAt: '2026-10-12T10:00:00Z' }],
      deleted: [],
    });
    result = await engine.query(
      'SELECT record_payload FROM health_connect_records WHERE user_id=$1 AND record_id=$2',
      [user, record.id],
    );
    expect(result.rows[0].record_payload.value).toBe(73);
  });
  it('rebuild and deletion preserve manual values and untouched legacy history', async () => {
    await engine.exec(
      `INSERT INTO body_metrics(user_id,date,weight_kg,source_map) VALUES('${user}','2026-10-12',80,'{"weight_kg":"manual"}'),('${user}','2020-01-01',60,'{"weight_kg":"health_connect"}');`,
    );
    const current = { ...record, id: 'weight-two' };
    await applyHealthConnectBatch(db, user, { records: [current], deleted: [] });
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    await applyHealthConnectBatch(db, user, { records: [], deleted: [current.id] });
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    const result = await engine.query<{ date: string; weight_kg: number }>(
      'SELECT date::text,weight_kg FROM body_metrics WHERE user_id=$1 ORDER BY date',
      [user],
    );
    expect(result.rows.map((row) => row.weight_kg)).toEqual([60, 80]);
  });
  it('heart-rate deletion is scoped to its account even when timestamps and values overlap', async () => {
    const heart: HealthConnectRecord = {
      ...record,
      id: 'heart-one',
      type: 'HeartRate',
      value: undefined,
      start: '2026-10-12T07:00:00Z',
      end: '2026-10-12T07:02:00Z',
      points: [
        { at: '2026-10-12T07:00:00Z', bpm: 65 },
        { at: '2026-10-12T07:01:00Z', bpm: 70 },
      ],
    };
    await applyHealthConnectBatch(db, user, { records: [heart], deleted: [] });
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    await applyHealthConnectBatch(db, other, { records: [heart], deleted: [] });
    await rebuildHealthConnect(db, other, 'Australia/Brisbane');
    await applyHealthConnectBatch(db, user, { records: [], deleted: [heart.id] });
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    const result = await engine.query<{ user_id: string; bpm: number }>(
      'SELECT user_id,bpm FROM oura_heartrate ORDER BY user_id,timestamp',
    );
    expect(result.rows).toEqual([
      { user_id: other, bpm: 65 },
      { user_id: other, bpm: 70 },
    ]);
  });
  it('invalidates historical derived caches only for the importing account', async () => {
    await engine.exec(`INSERT INTO body_battery_daily(user_id,date) VALUES('${user}','2020-01-01'),('${other}','2020-01-01');
      INSERT INTO oura_daily_derived(user_id,day,readiness_source,readiness_score,sleep_score,activity_score) VALUES
      ('${user}','2020-01-01','generic-derived',80,80,80),('${other}','2020-01-01','generic-derived',80,80,80),('${user}','2020-01-02','oura',90,90,90);`);
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    const battery = await engine.query('SELECT user_id FROM body_battery_daily');
    expect(battery.rows).toEqual([{ user_id: other }]);
    const scores = await engine.query(
      'SELECT user_id,readiness_source,readiness_score FROM oura_daily_derived ORDER BY user_id,day',
    );
    expect(scores.rows).toEqual([
      { user_id: user, readiness_source: 'generic-derived', readiness_score: null },
      { user_id: user, readiness_source: 'oura', readiness_score: 90 },
      { user_id: other, readiness_source: 'generic-derived', readiness_score: 80 },
    ]);
  });
  it('feeds native Apple/Android movement to the minute cascade with provenance and account/deletion guards', async () => {
    const sampleId = '00000000-0000-4000-8000-000000000099';
    await engine.query(
      `INSERT INTO apple_health_samples(user_id,sample_id,sample_type,start_at,end_at,quantity_value,source_bundle_id) VALUES
      ($1,$3,'HKQuantityTypeIdentifierStepCount','2026-10-12T01:00:00Z','2026-10-12T01:10:00Z',1000,'com.test.applewatch'),
      ($2,$3,'HKQuantityTypeIdentifierStepCount','2026-10-12T01:00:00Z','2026-10-12T01:10:00Z',9999,'com.test.other')`,
      [user, other, sampleId],
    );
    const steps: HealthConnectRecord = {
      ...record,
      id: 'movement-steps',
      type: 'Steps',
      value: 1200,
      start: '2026-10-12T02:00:00Z',
      end: '2026-10-12T02:10:00Z',
    };
    const calories: HealthConnectRecord = {
      ...steps,
      id: 'movement-energy',
      type: 'ActiveCaloriesBurned',
      value: 25,
    };
    await applyHealthConnectBatch(db, user, { records: [steps, calories], deleted: [] });
    const from = new Date('2026-10-12T00:00:00Z'),
      to = new Date('2026-10-13T00:00:00Z');
    const values = await getNativeMovementIntervals(db, user, 'steps', from, to);
    expect(values.map((row) => row.value)).toEqual([1000, 1200]);
    expect(values.map((row) => row.dataOrigin)).toEqual([
      'com.test.applewatch',
      'com.test.scale',
    ]);
    expect(values.map((row) => row.recordId)).toEqual([
      `apple_health:${sampleId}`,
      'health_connect:movement-steps',
    ]);
    expect((await getNativeMovementIntervals(db, user, 'active_kcal', from, to))[0].value).toBe(
      25,
    );
    await applyHealthConnectBatch(db, user, {
      records: [{ ...steps, value: 1500, modifiedAt: '2026-10-12T09:00:00Z' }],
      deleted: [],
    });
    expect((await getNativeMovementIntervals(db, user, 'steps', from, to))[1].value).toBe(1500);
    await applyHealthConnectBatch(db, user, { records: [], deleted: [steps.id] });
    await engine.query('UPDATE apple_health_samples SET deleted_at=now() WHERE user_id=$1', [
      user,
    ]);
    expect(await getNativeMovementIntervals(db, user, 'steps', from, to)).toEqual([]);
    expect((await getNativeMovementIntervals(db, other, 'steps', from, to))[0].value).toBe(
      9999,
    );
  });
});
