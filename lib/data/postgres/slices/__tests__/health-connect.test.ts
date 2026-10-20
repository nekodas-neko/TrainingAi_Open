import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb, getPool, ensureSchema } from '../../client';
import { applyHealthConnectBatch, rebuildHealthConnect } from '../health-connect';
import { getNativeMovementIntervals } from '../native-movement';
import { applyAppleHealthBatch, rebuildAppleHealth } from '../apple-health';
import type { HealthConnectRecord } from '@trainingai/shared/validation/health-connect-import';
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils';
const user = randomUUID(),
  other = randomUUID();
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
const url = process.env.DATABASE_URL;
const canRun = !!url && ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
const engine = {
  exec: (sql: string) => getPool().query(sql),
  query: <T extends Record<string, unknown>>(sql: string, values?: unknown[]) =>
    getPool().query<T>(sql, values),
};
let db: Parameters<typeof applyHealthConnectBatch>[0];
beforeAll(async () => {
  if (!canRun) return;
  await ensureSchema();
  await engine.exec(
    `INSERT INTO users(id,email) VALUES('${user}','${user}@example.invalid'),('${other}','${other}@example.invalid');`,
  );
  db = getDb();
});
afterAll(async () => {
  if (canRun)
    await getPool().query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[user, other]]);
});
describe.skipIf(!canRun)('Health Connect ledger and projections', () => {
  it('keeps manual sleep and permanent zone/battery history after an Apple import', async () => {
    const start = '2026-10-10T22:00:00Z', end = '2026-10-11T06:00:00Z';
    await engine.query(`INSERT INTO sleep_sessions(user_id,date,sleep_start,sleep_end,duration_hours,manual_entry,source_map)
      VALUES($1,'2026-10-11',$2,$3,9,true,'{"duration_hours":"manual"}')`, [user,start,end]);
    await engine.query(`INSERT INTO daily_zone_minutes(user_id,day,zone2_sec,max_hr,resting_hr)
      VALUES($1,'2020-01-01',1200,190,60)`, [user]);
    await applyAppleHealthBatch(db,user,{type:'HKCategoryTypeIdentifierSleepAnalysis',samples:[{
      id:randomUUID(),start,end,value:4,sourceBundleId:'com.test.watch',sourceName:'Watch',
    }],deleted:[]},'UTC');
    await rebuildAppleHealth(db,user,'UTC');
    const manual = await engine.query('SELECT duration_hours,manual_entry FROM sleep_sessions WHERE user_id=$1 AND sleep_start=$2',[user,start]);
    expect(manual.rows[0]).toEqual({duration_hours:9,manual_entry:true});
    expect((await engine.query('SELECT zone2_sec,max_hr FROM daily_zone_minutes WHERE user_id=$1 AND day=$2',[user,'2020-01-01'])).rows[0])
      .toEqual({zone2_sec:1200,max_hr:190});
  });
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
      'SELECT user_id,bpm FROM oura_heartrate WHERE user_id=ANY($1::uuid[]) ORDER BY user_id,timestamp',
      [[user, other]],
    );
    expect(result.rows).toEqual([
      { user_id: other, bpm: 65 },
      { user_id: other, bpm: 70 },
    ]);
  });
  it('preserves historical snapshots outside the uploaded dates', async () => {
    await engine.exec(`INSERT INTO body_battery_daily(user_id,date,anchor,anchor_source,end_value,day_min,day_max,total_charged,total_drained,resting_hr,hr_max,model_version) VALUES('${user}','2020-01-01',80,'sleep',70,60,80,10,20,60,190,'test'),('${other}','2020-01-01',80,'sleep',70,60,80,10,20,60,190,'test');
      INSERT INTO oura_daily_derived(user_id,day,readiness_source,readiness_score,sleep_score,activity_score) VALUES
      ('${user}','2020-01-01','generic-derived',80,80,80),('${other}','2020-01-01','generic-derived',80,80,80),('${user}','2020-01-02','oura',90,90,90);`);
    await rebuildHealthConnect(db, user, 'Australia/Brisbane');
    const battery = await engine.query(
      'SELECT user_id FROM body_battery_daily WHERE user_id=ANY($1::uuid[]) ORDER BY user_id=$2 DESC',
      [[user, other], user],
    );
    expect(battery.rows).toEqual([{ user_id: user }, { user_id: other }]);
    const scores = await engine.query(
      'SELECT user_id,readiness_source,readiness_score FROM oura_daily_derived WHERE user_id=ANY($2::uuid[]) ORDER BY user_id=$1 DESC,day',
      [user, [user, other]],
    );
    expect(scores.rows).toEqual([
      { user_id: user, readiness_source: 'generic-derived', readiness_score: 80 },
      { user_id: user, readiness_source: 'oura', readiness_score: 90 },
      { user_id: other, readiness_source: 'generic-derived', readiness_score: 80 },
    ]);
  });
  it('feeds native Apple/Android movement to the minute cascade with provenance and account/deletion guards', async () => {
    const sampleId = '00000000-0000-4000-8000-000000000099';
    await engine.query(
      `INSERT INTO apple_health_samples(user_id,sample_id,sample_type,start_at,end_at,quantity_value,source_bundle_id,quantity_unit) VALUES
      ($1,$3,'HKQuantityTypeIdentifierStepCount','2026-10-12T01:00:00Z','2026-10-12T01:10:00Z',1000,'com.test.applewatch','count'),
      ($2,$3,'HKQuantityTypeIdentifierStepCount','2026-10-12T01:00:00Z','2026-10-12T01:10:00Z',9999,'com.test.other','count')`,
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
  it('#2992: clears only readiness this import fed, so an Oura Cloud day keeps its scores', async () => {
    // Inside the HR retention window, anchored to local midday two days ago.
    const tz = 'Australia/Brisbane';
    const day = shiftDateStr(todayInTz(tz), -2);
    const noon = new Date(dateStrMidnightInTz(day, tz).getTime() + 12 * 3_600_000);
    const heart: HealthConnectRecord = {
      ...record,
      id: 'heart-2992',
      type: 'HeartRate',
      value: undefined,
      start: noon.toISOString(),
      end: new Date(noon.getTime() + 120_000).toISOString(),
      points: [{ at: noon.toISOString(), bpm: 66 }],
    };
    const third = randomUUID(), fourth = randomUUID();
    await engine.query(
      'INSERT INTO users(id,email) VALUES($1,$2),($3,$4)',
      [third, `${third}@example.invalid`, fourth, `${fourth}@example.invalid`],
    );
    const contributors = (src: string | null) =>
      JSON.stringify({ hrvBalance: { score: 60, provisional: false, input: 0.3, gap: null, ...(src ? { source: src } : {}) } });
    try {
      await engine.query(
        `INSERT INTO oura_daily_derived(user_id,day,readiness_source,readiness_score,readiness_contributors,illness_flag,illness_score) VALUES
         ($1,$5,'generic-derived',71,$6::jsonb,'elevated',40),($2,$5,'generic-derived',72,$7::jsonb,'elevated',40),
         ($3,$5,'generic-derived',73,$8::jsonb,NULL,NULL),($4,$5,'ble-derived',74,$7::jsonb,'elevated',40)`,
        [user, other, third, fourth, day, contributors('oura_cloud'), contributors('health_connect_native'), contributors(null)],
      );
      for (const id of [user, other, third, fourth]) {
        await applyHealthConnectBatch(db, id, { records: [heart], deleted: [] });
        await rebuildHealthConnect(db, id, tz);
      }
      const rows = await engine.query<{ user_id: string; readiness_score: number | null; illness_flag: string | null; illness_score: number | null }>(
        'SELECT user_id,readiness_score,illness_flag,illness_score FROM oura_daily_derived WHERE day=$1 AND user_id=ANY($2::uuid[])',
        [day, [user, other, third, fourth]],
      );
      const byUser = new Map(rows.rows.map((r) => [r.user_id, r.readiness_score]));
      expect(byUser.get(user)).toBe(71); // Oura Cloud inputs: kept
      expect(byUser.get(other)).toBeNull(); // this import's inputs: cleared for recompute
      expect(byUser.get(third)).toBeNull(); // no provenance (before #2984): cleared as before
      expect(byUser.get(fourth)).toBe(74); // ring-derived: never touched
      // #3163 review: the illness radar's fields go with the readiness they were stored beside.
      const flags = new Map(rows.rows.map((r) => [r.user_id, [r.illness_flag, r.illness_score]]));
      expect(flags.get(user)).toEqual(['elevated', 40]);
      expect(flags.get(other)).toEqual([null, null]);
      expect(flags.get(fourth)).toEqual(['elevated', 40]);
    } finally {
      await getPool().query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[third, fourth]]);
    }
  });
});
