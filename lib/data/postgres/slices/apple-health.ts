import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import * as s from '../schema';
import {
  appleTypes,
  type AppleImportBatch,
  type AppleSample,
} from '@trainingai/shared/validation/apple-health-import';
import { projectAppleHealth } from '@trainingai/shared/health/apple-health-projection';
import { todayInTz } from '@trainingai/shared/date-utils';
import { initialSourceMap, mergeSet, type SourceColumn } from '../../health-source';

type Db = ReturnType<typeof getDb>;
const columns: SourceColumn[] = [
  ['weightKg', 'weight_kg'],
  ['restingHeartRate', 'resting_heart_rate'],
  ['steps', 'steps'],
  ['activeCalories', 'active_calories'],
].map(([prop, col]) => ({ prop, col }));
const sleepColumns: SourceColumn[] = [
  ['durationHours', 'duration_hours'],
  ['deepSleepHours', 'deep_sleep_hours'],
  ['remSleepHours', 'rem_sleep_hours'],
  ['lightSleepHours', 'light_sleep_hours'],
  ['awakHours', 'awake_hours'],
  ['sleepPhase5Min', 'sleep_phase_5_min'],
].map(([prop, col]) => ({ prop, col }));

export async function applyAppleHealthBatch(db: Db, userId: string, batch: AppleImportBatch) {
  const t = s.appleHealthSamples;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`apple-health:${userId}`},0))`,
    );
    if (batch.samples.length) {
      await tx
        .insert(t)
        .values(
          batch.samples.map((row) => ({
            userId,
            sampleId: row.id,
            sampleType: batch.type,
            startAt: new Date(row.start),
            endAt: new Date(row.end),
            quantityValue: appleTypes[batch.type].unit ? row.value : null,
            quantityUnit: appleTypes[batch.type].unit,
            categoryValue: appleTypes[batch.type].unit ? null : row.value,
            sourceBundleId: row.sourceBundleId,
            sourceName: row.sourceName,
            deviceName: row.deviceName,
            deviceModel: row.deviceModel,
          })),
        )
        .onConflictDoNothing();
    }
    if (batch.deleted.length) {
      await tx
        .insert(t)
        .values(
          batch.deleted.map((id) => ({
            userId,
            sampleId: id,
            sampleType: batch.type,
            deletedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [t.userId, t.sampleId],
          set: {
            deletedAt: sql`COALESCE(${t.deletedAt},excluded.deleted_at)`,
            updatedAt: sql`CASE WHEN ${t.deletedAt} IS NULL THEN NOW() ELSE ${t.updatedAt} END`,
          },
        });
    }
  });
  return { accepted: batch.samples.length, deleted: batch.deleted.length };
}

export async function rebuildAppleHealth(db: Db, userId: string, timezone: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`apple-health:${userId}`},0))`,
    );
    const rows = await tx
      .select()
      .from(s.appleHealthSamples)
      .where(and(eq(s.appleHealthSamples.userId, userId), isNull(s.appleHealthSamples.deletedAt)));
    const samples: AppleSample[] = rows.flatMap((row) =>
      row.startAt && row.endAt && row.sourceBundleId && row.sampleType in appleTypes
        ? [
            {
              id: row.sampleId,
              type: row.sampleType as AppleSample['type'],
              start: row.startAt.toISOString(),
              end: row.endAt.toISOString(),
              value: row.quantityValue ?? row.categoryValue ?? 0,
              sourceBundleId: row.sourceBundleId,
              sourceName: row.sourceName ?? row.sourceBundleId,
              deviceName: row.deviceName,
              deviceModel: row.deviceModel,
            },
          ]
        : [],
    );
    const result = projectAppleHealth(samples, timezone);
    const body = s.bodyMetrics;
    const owned = sql`(${body.sourceMap}->>'weight_kg'='apple_health' OR ${body.sourceMap}->>'resting_heart_rate'='apple_health' OR ${body.sourceMap}->>'steps'='apple_health' OR ${body.sourceMap}->>'active_calories'='apple_health')`;
    const clear = Object.fromEntries(
      columns.map(({ prop, col }) => [
        prop,
        sql.raw(`CASE WHEN source_map->>'${col}'='apple_health' THEN NULL ELSE ${col} END`),
      ]),
    );
    await tx
      .update(body)
      .set({
        ...clear,
        sourceMap: sql`COALESCE(${body.sourceMap},'{}'::jsonb)-ARRAY(SELECT key FROM jsonb_each_text(COALESCE(${body.sourceMap},'{}'::jsonb)) WHERE value='apple_health' AND key IN ('weight_kg','resting_heart_rate','steps','active_calories'))`,
        updatedAt: new Date(),
      })
      .where(and(eq(body.userId, userId), owned));
    if (result.daily.length) {
      await tx
        .insert(body)
        .values(
          result.daily.map((day) => ({
            userId,
            ...day,
            sourceMap: initialSourceMap(columns, day, 'apple_health'),
          })),
        )
        .onConflictDoUpdate({
          target: [body.userId, body.date],
          set: { ...mergeSet('body_metrics', columns, 'apple_health'), updatedAt: new Date() },
        });
    }
    const sleep = s.sleepSessions;
    await tx
      .update(sleep)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(sleep.userId, userId),
          sql`${sleep.ouraId} LIKE 'apple-health:%'`,
          sql`${sleep.sourceMap}->>'duration_hours'='apple_health'`,
          isNull(sleep.deletedAt),
        ),
      );
    if (result.sleep.length) {
      const mergedSleep = mergeSet('sleep_sessions', sleepColumns, 'apple_health');
      const replaceWhole = sql`${sleep.manualEntry} OR ${sleep.deletedAt} IS NOT NULL`;
      const wins = sql`${replaceWhole} OR COALESCE(${sleep.sourceMap}->>'duration_hours','apple_health') IN ('apple_health','health_connect')`;
      await tx
        .insert(sleep)
        .values(
          result.sleep.map((night) => ({
            userId,
            date: night.date,
            ouraId: `apple-health:${night.sleepStart}`,
            sleepStart: new Date(night.sleepStart),
            sleepEnd: new Date(night.sleepEnd),
            durationHours: night.durationHours,
            deepSleepHours: night.deepSleepHours,
            remSleepHours: night.remSleepHours,
            lightSleepHours: night.lightSleepHours,
            awakHours: night.awakHours,
            sleepPhase5Min: night.sleepPhase5Min,
            sourceMap: initialSourceMap(sleepColumns, night, 'apple_health'),
          })),
        )
        .onConflictDoUpdate({
          target: [sleep.userId, sleep.sleepStart],
          set: {
            ...Object.fromEntries(
              sleepColumns.map(({ prop, col }) => [
                prop,
                sql`CASE WHEN ${replaceWhole} OR ${sleep.sourceMap}->>${col}='apple_health' THEN ${sql.raw(`excluded.${col}`)} ELSE ${mergedSleep[prop]} END`,
              ]),
            ),
            sourceMap: sql`CASE WHEN ${replaceWhole} THEN excluded.source_map ELSE ${mergedSleep.sourceMap} END`,
            sleepEnd: sql`CASE WHEN ${wins} THEN excluded.sleep_end ELSE ${sleep.sleepEnd} END`,
            ouraId: sql`CASE WHEN ${wins} THEN excluded.oura_id ELSE ${sleep.ouraId} END`,
            manualEntry: false,
            deletedAt: null,
            updatedAt: new Date(),
          },
        });
    }
    const hr = s.ouraHeartrate;
    await tx.delete(hr).where(and(eq(hr.userId, userId), eq(hr.source, 'apple_health')));
    for (let offset = 0; offset < result.heart.length; offset += 1000) {
      await tx
        .insert(hr)
        .values(
          result.heart
            .slice(offset, offset + 1000)
            .map((row) => ({ userId, ...row, source: 'apple_health' })),
        )
        .onConflictDoUpdate({
          target: [hr.userId, hr.timestamp],
          set: { bpm: sql`excluded.bpm`, source: 'apple_health', updatedAt: new Date() },
          setWhere: sql`${hr.source}='apple_health'`,
        });
    }
    await tx.delete(s.dailyZoneMinutes).where(eq(s.dailyZoneMinutes.userId, userId));
    const today = todayInTz(timezone);
    await tx
      .delete(s.bodyBatteryDaily)
      .where(and(eq(s.bodyBatteryDaily.userId, userId), eq(s.bodyBatteryDaily.date, today)));
    await tx
      .update(s.ouraDailyDerived)
      .set({ readinessScore: null, sleepScore: null, activityScore: null })
      .where(
        and(
          eq(s.ouraDailyDerived.userId, userId),
          eq(s.ouraDailyDerived.day, today),
          eq(s.ouraDailyDerived.readinessSource, 'generic-derived'),
        ),
      );
    return {
      measurements: rows.length,
      nights: result.sleep.length,
      days: result.daily.length,
      heartRate: result.heart.length,
      hrv: result.hrv,
      completedAt: new Date().toISOString(),
    };
  });
}
