import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import * as s from '../schema';
import type { HealthConnectBatch } from '@trainingai/shared/validation/health-connect-import';
import { projectHealthConnect } from '@trainingai/shared/health/health-connect-projection';
import { initialSourceMap, mergeSet, type SourceColumn } from '../../health-source';

type Db = ReturnType<typeof getDb>;
const columns: SourceColumn[] = [
  ['weightKg', 'weight_kg'],
  ['restingHeartRate', 'resting_heart_rate'],
  ['steps', 'steps'],
  ['activeCalories', 'active_calories'],
  ['hrvMs', 'hrv_ms'],
].map(([prop, col]) => ({ prop, col }));
const sleepColumns: SourceColumn[] = [
  ['durationHours', 'duration_hours'],
  ['deepSleepHours', 'deep_sleep_hours'],
  ['remSleepHours', 'rem_sleep_hours'],
  ['lightSleepHours', 'light_sleep_hours'],
  ['awakHours', 'awake_hours'],
  ['sleepPhase5Min', 'sleep_phase_5_min'],
].map(([prop, col]) => ({ prop, col }));
const lock = (userId: string) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`health-connect:${userId}`},0))`;
export async function applyHealthConnectBatch(
  db: Db,
  userId: string,
  batch: HealthConnectBatch,
) {
  const t = s.healthConnectRecords;
  await db.transaction(async (tx) => {
    await tx.execute(lock(userId));
    if (batch.records.length)
      await tx
        .insert(t)
        .values(
          batch.records.map((row) => ({
            userId,
            recordId: row.id,
            recordPayload: row,
            modifiedAt: new Date(row.modifiedAt),
          })),
        )
        .onConflictDoUpdate({
          target: [t.userId, t.recordId],
          set: {
            recordPayload: sql`excluded.record_payload`,
            modifiedAt: sql`excluded.modified_at`,
            updatedAt: new Date(),
          },
          setWhere: sql`${t.deletedAt} IS NULL AND excluded.modified_at >= ${t.modifiedAt}`,
        });
    if (batch.deleted.length)
      await tx
        .insert(t)
        .values(batch.deleted.map((recordId) => ({ userId, recordId, deletedAt: new Date() })))
        .onConflictDoUpdate({
          target: [t.userId, t.recordId],
          set: {
            deletedAt: sql`COALESCE(${t.deletedAt},excluded.deleted_at)`,
            updatedAt: new Date(),
          },
        });
  });
  return { accepted: batch.records.length, deleted: batch.deleted.length };
}
export async function rebuildHealthConnect(db: Db, userId: string, timezone: string) {
  return db.transaction(async (tx) => {
    await tx.execute(lock(userId));
    const records = await tx
      .select()
      .from(s.healthConnectRecords)
      .where(
        and(
          eq(s.healthConnectRecords.userId, userId),
          isNull(s.healthConnectRecords.deletedAt),
        ),
      );
    const result = projectHealthConnect(
      records.flatMap((row) => (row.recordPayload ? [row.recordPayload] : [])),
      timezone,
    );
    const previous = (
      await tx
        .select()
        .from(s.healthConnectProjectionState)
        .where(eq(s.healthConnectProjectionState.userId, userId))
    )[0]?.payload;
    const body = s.bodyMetrics;
    for (const day of previous?.daily ?? []) {
      for (const { prop, col } of columns) {
        const value = day[prop as keyof typeof day];
        if (typeof value !== 'number') continue;
        await tx
          .update(body)
          .set({
            [prop]: null,
            sourceMap: sql`COALESCE(${body.sourceMap},'{}'::jsonb)-${col}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(body.userId, userId),
              eq(body.date, day.date),
              sql`${body.sourceMap}->>${col}='health_connect' AND ${sql.raw(col)}=${value}`,
            ),
          );
      }
    }
    if (result.daily.length)
      await tx
        .insert(body)
        .values(
          result.daily.map((day) => ({
            userId,
            ...day,
            sourceMap: initialSourceMap(columns, day, 'health_connect'),
          })),
        )
        .onConflictDoUpdate({
          target: [body.userId, body.date],
          set: {
            ...mergeSet('body_metrics', columns, 'health_connect'),
            updatedAt: new Date(),
          },
        });
    const sleep = s.sleepSessions;
    await tx
      .update(sleep)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(sleep.userId, userId),
          sql`${sleep.ouraId} LIKE 'health-connect-native:%'`,
          sql`${sleep.sourceMap}->>'duration_hours'='health_connect'`,
          isNull(sleep.deletedAt),
        ),
      );
    if (result.sleep.length) {
      const merged = mergeSet('sleep_sessions', sleepColumns, 'health_connect');
      const replace = sql`${sleep.deletedAt} IS NOT NULL`;
      const wins = sql`${replace} OR COALESCE(${sleep.sourceMap}->>'duration_hours','health_connect') IN ('health_connect','apple_health')`;
      await tx
        .insert(sleep)
        .values(
          result.sleep.map((night) => ({
            userId,
            date: night.date,
            ouraId: `health-connect-native:${night.sleepStart}`,
            sleepStart: new Date(night.sleepStart),
            sleepEnd: new Date(night.sleepEnd),
            durationHours: night.durationHours,
            deepSleepHours: night.deepSleepHours,
            remSleepHours: night.remSleepHours,
            lightSleepHours: night.lightSleepHours,
            awakHours: night.awakHours,
            sleepPhase5Min: night.sleepPhase5Min,
            sourceMap: initialSourceMap(sleepColumns, night, 'health_connect'),
          })),
        )
        .onConflictDoUpdate({
          target: [sleep.userId, sleep.sleepStart],
          set: {
            ...Object.fromEntries(
              sleepColumns.map(({ prop, col }) => [
                prop,
                sql`CASE WHEN ${replace} OR ${sleep.sourceMap}->>${col}='health_connect' THEN ${sql.raw(`excluded.${col}`)} ELSE ${merged[prop]} END`,
              ]),
            ),
            sourceMap: sql`CASE WHEN ${replace} THEN excluded.source_map ELSE ${merged.sourceMap} END`,
            sleepEnd: sql`CASE WHEN ${wins} THEN excluded.sleep_end ELSE ${sleep.sleepEnd} END`,
            ouraId: sql`CASE WHEN ${wins} THEN excluded.oura_id ELSE ${sleep.ouraId} END`,
            manualEntry: sql`CASE WHEN ${wins} THEN false ELSE ${sleep.manualEntry} END`,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
    }
    const hr = s.ouraHeartrate;
    for (let i = 0; i < (previous?.heart.length ?? 0); i += 1000) {
      const points = previous!.heart.slice(i, i + 1000);
      await tx.delete(hr).where(
        and(
          eq(hr.userId, userId),
          eq(hr.source, 'health_connect'),
          sql`(${sql.join(
            points.map(
              (row) =>
                sql`(${hr.timestamp}=${new Date(row.timestamp)} AND ${hr.bpm}=${row.bpm})`,
            ),
            sql` OR `,
          )})`,
        ),
      );
    }
    for (let i = 0; i < result.heart.length; i += 1000)
      await tx
        .insert(hr)
        .values(
          result.heart
            .slice(i, i + 1000)
            .map((point) => ({ userId, ...point, source: 'health_connect' })),
        )
        .onConflictDoUpdate({
          target: [hr.userId, hr.timestamp],
          set: { bpm: sql`excluded.bpm`, source: 'health_connect', updatedAt: new Date() },
          setWhere: sql`${hr.source}='health_connect'`,
        });
    await tx
      .insert(s.healthConnectProjectionState)
      .values({
        userId,
        payload: {
          daily: result.daily,
          heart: result.heart.map((row) => ({
            ...row,
            timestamp: row.timestamp.toISOString(),
          })),
        },
      })
      .onConflictDoUpdate({
        target: s.healthConnectProjectionState.userId,
        set: { payload: sql`excluded.payload` },
      });
    await tx.delete(s.dailyZoneMinutes).where(eq(s.dailyZoneMinutes.userId, userId));
    await tx.delete(s.bodyBatteryDaily).where(eq(s.bodyBatteryDaily.userId, userId));
    await tx
      .update(s.ouraDailyDerived)
      .set({ readinessScore: null, sleepScore: null, activityScore: null })
      .where(
        and(
          eq(s.ouraDailyDerived.userId, userId),
          eq(s.ouraDailyDerived.readinessSource, 'generic-derived'),
        ),
      );
    return {
      measurements: records.length,
      nights: result.sleep.length,
      days: result.daily.length,
      heartRate: result.heart.length,
      hrv: result.hrv,
      completedAt: new Date().toISOString(),
    };
  });
}
