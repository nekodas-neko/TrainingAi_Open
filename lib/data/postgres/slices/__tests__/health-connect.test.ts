import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import * as schema from '../../schema';
import { applyHealthConnectBatch, rebuildHealthConnect } from '../health-connect';
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
});
