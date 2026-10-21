import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { DEFAULT_TZ, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils';
import { projectDeviceHealth } from '@trainingai/shared/health/device-health-projection';
import { groupSleepPeriods } from '@trainingai/shared/health/sleep-night';
import { HEALTH_IMPORT_MAX_INTERVAL_DAYS } from '@trainingai/shared/health/import-limits';
import { HR_RETENTION_DAYS, settleNights } from './oura';
import { initialSourceMap, mergeSet, type SourceColumn } from '../../health-source';
import type { getDb } from '../client';
import * as s from '../schema';

type Db = ReturnType<typeof getDb>;
export type NativeHealthSource = 'apple_health' | 'health_connect_native';
type Interval = { start: string; end: string; sleep?: boolean };
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
export const projectionLock = (userId: string, source: NativeHealthSource) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`native-health:${source}:${userId}`},0))`;
export function healthProjectionStart(from: Date, timezone: string) {
  return fromZonedTime(`${shiftDateStr(formatInTimeZone(from, timezone, 'yyyy-MM-dd'), -HEALTH_IMPORT_MAX_INTERVAL_DAYS)}T00:00:00`, timezone);
}

export async function queueHealthDays(
  db: Db,
  userId: string,
  source: NativeHealthSource,
  intervals: Interval[],
  timezone = DEFAULT_TZ,
) {
  const days = new Set<string>();
  for (const row of intervals) {
    const first = formatInTimeZone(new Date(row.start), timezone, 'yyyy-MM-dd');
    const last = formatInTimeZone(new Date(row.end), timezone, 'yyyy-MM-dd');
    for (
      let day = first, count = 0;
      day <= last && count < 32;
      day = shiftDateStr(day, 1), count++
    )
      days.add(day);
    if (row.sleep) {
      const periods = groupSleepPeriods([{ sleepStart: new Date(row.start), sleepEnd: new Date(row.end),
        durationHours: (Date.parse(row.end) - Date.parse(row.start)) / 3600000 }], timezone);
      for (const night of periods.nights) days.add(night.date);
    }
  }
  if (days.size)
    await db
      .insert(s.nativeHealthProjectionDays)
      .values([...days].map((day) => ({ userId, source, day })))
      .onConflictDoUpdate({
        target: [
          s.nativeHealthProjectionDays.userId,
          s.nativeHealthProjectionDays.source,
          s.nativeHealthProjectionDays.day,
        ],
        set: { pending: true },
      });
}

export async function rebuildNativeHealth(
  db: Db,
  userId: string,
  source: NativeHealthSource,
  timezone: string,
  project: (db: Db, from: Date, to: Date) => Promise<ReturnType<typeof projectDeviceHealth>>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(projectionLock(userId, source));
    const state = s.nativeHealthProjectionDays;
    const pending = await tx
      .select()
      .from(state)
      .where(and(eq(state.userId, userId), eq(state.source, source), eq(state.pending, true)))
      .orderBy(asc(state.day))
      .limit(7);
    const days = pending.filter((row) => row.day <= shiftDateStr(pending[0].day, 6));
    const keys = days.map((row) => row.day);
    const from = days.length
      ? fromZonedTime(`${shiftDateStr(keys[0], -1)}T00:00:00`, timezone)
      : new Date();
    const to = days.length
      ? fromZonedTime(`${shiftDateStr(keys.at(-1)!, 2)}T00:00:00`, timezone)
      : from;
    const result = days.length
      ? await project(tx as unknown as Db, from, to)
      : {
          daily: [],
          sleep: [],
          heart: [],
          hrv: null,
        };
    const daily = result.daily.filter((day) => keys.includes(day.date));
    const heart = result.heart.filter((point) =>
      keys.includes(formatInTimeZone(point.timestamp, timezone, 'yyyy-MM-dd')),
    );
    const body = s.bodyMetrics;
    for (const row of days) {
      const current = daily.find((day) => day.date === row.day);
      for (const { prop, col } of columns) {
        if (
          current?.[prop as keyof typeof current] != null ||
          typeof row.daily?.[prop] !== 'number'
        )
          continue;
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
              eq(body.date, row.day),
              sql`${body.sourceMap}->>${col}=${source} AND ${sql.raw(col)}=${row.daily![prop]}`,
            ),
          );
      }
    }
    if (daily.length)
      await tx
        .insert(body)
        .values(
          daily.map((day) => ({
            userId,
            ...day,
            sourceMap: initialSourceMap(columns, day, source),
          })),
        )
        .onConflictDoUpdate({
          target: [body.userId, body.date],
          set: { ...mergeSet('body_metrics', columns, source), updatedAt: new Date() },
        });

    const t = s.sleepSessions;
    const prefix = source === 'apple_health' ? 'apple-health:' : 'health-connect-native:';
    // #3115: each night follows the night ladder before it is written. One a higher-ranked night
    // already holds (Oura Cloud, the ring, the legacy Health Connect writer) is not written, and its
    // own earlier row is tombstoned below with the other nights no longer projected.
    const { kept } = await settleNights(
      tx as unknown as Db,
      userId,
      result.sleep
        .filter((night) => keys.includes(night.date))
        .map((night) => ({
          night,
          sleepStart: new Date(night.sleepStart),
          sleepEnd: new Date(night.sleepEnd),
          durationHours: night.durationHours,
        })),
      source,
      { ownPrefix: prefix },
    );
    const sleep = kept.map(({ night }) => night);
    const starts = sleep.map((night) => new Date(night.sleepStart));
    if (keys.length)
      await tx
        .update(t)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(t.userId, userId),
            inArray(t.date, keys),
            eq(t.manualEntry, false),
            sql`${t.ouraId} LIKE ${prefix + '%'}`,
            sql`${t.sourceMap}->>'duration_hours'=${source}`,
            isNull(t.deletedAt),
            starts.length
              ? sql`${t.sleepStart} NOT IN (${sql.join(
                  starts.map((start) => sql`${start}`),
                  sql`,`,
                )})`
              : undefined,
          ),
        );
    if (sleep.length) {
      const merged = mergeSet('sleep_sessions', sleepColumns, source);
      const owns = sql`${t.deletedAt} IS NOT NULL OR (${merged.sourceMap})->>'duration_hours'=${source}`;
      await tx
        .insert(t)
        .values(
          sleep.map((night) => ({
            userId,
            date: night.date,
            ouraId: prefix + night.sleepStart,
            sleepStart: new Date(night.sleepStart),
            sleepEnd: new Date(night.sleepEnd),
            durationHours: night.durationHours,
            deepSleepHours: night.deepSleepHours,
            remSleepHours: night.remSleepHours,
            lightSleepHours: night.lightSleepHours,
            awakHours: night.awakHours,
            sleepPhase5Min: night.sleepPhase5Min,
            sourceMap: initialSourceMap(sleepColumns, night, source),
            manualEntry: false,
          })),
        )
        .onConflictDoUpdate({
          target: [t.userId, t.sleepStart],
          set: {
            ...Object.fromEntries(
              sleepColumns.map(({ prop, col }) => [
                prop,
                sql`CASE WHEN ${owns} THEN ${sql.raw(`excluded.${col}`)} ELSE ${merged[prop]} END`,
              ]),
            ),
            sourceMap: sql`CASE WHEN ${owns} THEN excluded.source_map ELSE ${merged.sourceMap} END`,
            sleepEnd: sql`CASE WHEN ${owns} THEN excluded.sleep_end ELSE ${t.sleepEnd} END`,
            ouraId: sql`CASE WHEN ${owns} THEN excluded.oura_id ELSE ${t.ouraId} END`,
            deletedAt: null,
            updatedAt: new Date(),
          },
          setWhere: eq(t.manualEntry, false),
        });
    }
    const hr = s.ouraHeartrate;
    const byTimestamp = new Map(heart.map((point) => [point.timestamp.getTime(), point.bpm]));
    if (keys.length) {
      const previous = await tx
        .select()
        .from(hr)
        .where(
          and(
            eq(hr.userId, userId),
            eq(hr.source, source),
            gte(hr.timestamp, from),
            lt(hr.timestamp, to),
          ),
        );
      const obsolete = previous.filter(
        (point) =>
          keys.includes(formatInTimeZone(point.timestamp, timezone, 'yyyy-MM-dd')) &&
          !byTimestamp.has(point.timestamp.getTime()),
      );
      for (let i = 0; i < obsolete.length; i += 500)
        await tx.delete(hr).where(
          and(
            eq(hr.userId, userId),
            eq(hr.source, source),
            inArray(
              hr.timestamp,
              obsolete.slice(i, i + 500).map((point) => point.timestamp),
            ),
          ),
        );
    }
    for (let i = 0; i < heart.length; i += 500)
      await tx
        .insert(hr)
        .values(heart.slice(i, i + 500).map((point) => ({ userId, ...point, source })))
        .onConflictDoUpdate({
          target: [hr.userId, hr.timestamp],
          set: { bpm: sql`excluded.bpm`, source, updatedAt: new Date() },
          setWhere: sql`${hr.source}=${source}`,
        });

    if (keys.length) {
      const recoverable = keys.filter((day) => day >= shiftDateStr(todayInTz(timezone), -HR_RETENTION_DAYS));
      if (recoverable.length) {
        await tx
          .update(s.dailyZoneMinutes)
          .set({ maxHr: null })
          .where(
            and(
              eq(s.dailyZoneMinutes.userId, userId),
              inArray(s.dailyZoneMinutes.day, recoverable),
            ),
          );
        await tx
          .update(s.ouraDailyDerived)
          // #3163 review: the illness radar's fields are stored beside readiness from the same inputs
          // (#3086), so a day cleared for recompute must not keep a flag the next read would not set.
          .set({
            readinessScore: null, sleepScore: null, activityScore: null,
            illnessFlag: null, illnessScore: null, illnessBiomarkers: null,
          })
          .where(
            and(
              eq(s.ouraDailyDerived.userId, userId),
              inArray(s.ouraDailyDerived.day, recoverable),
              eq(s.ouraDailyDerived.readinessSource, 'generic-derived'),
              // #2992: only a day this import fed. Since #2984 each contributor names its device, so
              // an Oura Cloud day (also `generic-derived` once no ring row is in the window) keeps
              // its scores; nulling it would leave the day empty, because the readiness read only
              // rewrites the current night. A row with no contributor sources predates that and is
              // cleared as before.
              sql`(${s.ouraDailyDerived.readinessContributors} IS NULL
                OR NOT jsonb_path_exists(${s.ouraDailyDerived.readinessContributors}, '$.*.source')
                OR (jsonb_path_exists(${s.ouraDailyDerived.readinessContributors}, '$.* ? (@.source == $src)', jsonb_build_object('src', ${source}::text))
                  -- #3077: a day any Oura input fed is never cleared, whatever its label. The live read
                  -- only rewrites the current night, so a cleared past day would be lost, not recomputed.
                  AND NOT jsonb_path_exists(${s.ouraDailyDerived.readinessContributors}, '$.* ? (@.source == "oura_cloud" || @.source == "oura_ble")')))`,
            ),
          );
      }
      await tx
        .insert(state)
        .values(
          days.map((row) => ({
            userId,
            source,
            day: row.day,
            pending: false,
            daily: daily.find((day) => day.date === row.day) ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [state.userId, state.source, state.day],
          set: { pending: false, daily: sql`excluded.daily` },
        });
    }
    const more = await tx
      .select({ day: state.day })
      .from(state)
      .where(and(eq(state.userId, userId), eq(state.source, source), eq(state.pending, true)))
      .limit(1);
    return {
      measurements: daily.length + sleep.length + heart.length,
      nights: sleep.length,
      days: daily.length,
      heartRate: heart.length,
      hrv: result.hrv,
      pending: more.length > 0,
      completedAt: new Date().toISOString(),
    };
  });
}
