import { eq, and, or, gte, lte, lt, asc, desc, isNotNull, isNull, inArray, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { getPool } from '../client'
import * as s from '../schema'
import type { OuraWorkout } from '@/lib/oura/types'
import type { OuraDailyRow, OuraSleepUpsertRow, OuraTagRow, OuraDailySummaryRow, OuraDailyDerivedRow, OuraDailyDerivedPatch, WorkoutHrStatsInput, WorkoutHrStatsRow, SetHrStatsRow, DaytimeHrvModelRow } from '../../repository'
import type { SetHrRow, RichSetMarker } from '@trainingai/shared/workout/set-hr-stats'
import { aestMidnight, todayInTz, DEFAULT_TZ, shiftDateStr } from '@trainingai/shared/date-utils'
import { shouldPrune } from '../retention-throttle'
import { bodyCompSnapshot } from '@trainingai/shared/health/body-composition'
import { mergeSet, initialSourceMap, type HealthSource, type SourceColumn } from '@/lib/data/health-source'

// Per-field provenance columns (migration 120) for the two multi-source Oura tables.
const OURA_DAILY_SOURCE_COLS: SourceColumn[] = [
  { prop: 'readinessScore', col: 'readiness_score' }, { prop: 'temperatureDeviation', col: 'temperature_deviation' },
  { prop: 'temperatureTrendDeviation', col: 'temperature_trend_deviation' }, { prop: 'readinessContributors', col: 'readiness_contributors' },
  { prop: 'sleepScore', col: 'sleep_score' }, { prop: 'sleepContributors', col: 'sleep_contributors' },
  { prop: 'activityScore', col: 'activity_score' }, { prop: 'activeCalories', col: 'active_calories' },
  { prop: 'totalCalories', col: 'total_calories' }, { prop: 'equivalentWalkingDistance', col: 'equivalent_walking_distance' },
  { prop: 'highActivityTimeSec', col: 'high_activity_time_sec' }, { prop: 'mediumActivityTimeSec', col: 'medium_activity_time_sec' },
  { prop: 'lowActivityTimeSec', col: 'low_activity_time_sec' }, { prop: 'sedentaryTimeSec', col: 'sedentary_time_sec' },
  { prop: 'nonWearTimeSec', col: 'non_wear_time_sec' }, { prop: 'activityContributors', col: 'activity_contributors' },
  { prop: 'restingTimeSec', col: 'resting_time_sec' }, { prop: 'avgMetMinutes', col: 'avg_met_minutes' },
  { prop: 'highActivityMetMinutes', col: 'high_activity_met_minutes' }, { prop: 'mediumActivityMetMinutes', col: 'medium_activity_met_minutes' },
  { prop: 'lowActivityMetMinutes', col: 'low_activity_met_minutes' }, { prop: 'stressHigh', col: 'stress_high' },
  { prop: 'recoveryHigh', col: 'recovery_high' }, { prop: 'daySummary', col: 'day_summary' },
  { prop: 'vo2Max', col: 'vo2_max' }, { prop: 'vascularAge', col: 'vascular_age' },
  { prop: 'pulseWaveVelocity', col: 'pulse_wave_velocity' }, { prop: 'resilienceLevel', col: 'resilience_level' },
  { prop: 'resilienceContributors', col: 'resilience_contributors' }, { prop: 'recommendedBedtimeStart', col: 'recommended_bedtime_start' },
  { prop: 'recommendedBedtimeEnd', col: 'recommended_bedtime_end' }, { prop: 'sleepTimeStatus', col: 'sleep_time_status' },
  { prop: 'sleepTimeRecommendation', col: 'sleep_time_recommendation' }, { prop: 'breathingDisturbanceIndex', col: 'breathing_disturbance_index' },
]
const OURA_SLEEP_SOURCE_COLS: SourceColumn[] = [
  { prop: 'ouraId', col: 'oura_id' }, { prop: 'durationHours', col: 'duration_hours' },
  { prop: 'deepSleepHours', col: 'deep_sleep_hours' }, { prop: 'remSleepHours', col: 'rem_sleep_hours' },
  { prop: 'lightSleepHours', col: 'light_sleep_hours' }, { prop: 'awakHours', col: 'awake_hours' },
  { prop: 'efficiency', col: 'efficiency' }, { prop: 'onsetLatencySec', col: 'onset_latency_sec' },
  { prop: 'averageHrvMs', col: 'average_hrv_ms' }, { prop: 'avgHeartRate', col: 'avg_heart_rate' },
  { prop: 'lowestHeartRate', col: 'lowest_heart_rate' }, { prop: 'restlessPeriods', col: 'restless_periods' },
  { prop: 'sleepScore', col: 'sleep_score' }, { prop: 'respiratoryRate', col: 'respiratory_rate' },
  { prop: 'sleepPhase5Min', col: 'sleep_phase_5_min' }, { prop: 'timeInBedHours', col: 'time_in_bed_hours' },
]
import { preferStrapBuckets } from '@trainingai/shared/health/hr-window-merge'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import { accumulateZoneSeconds, type HrReading } from '@trainingai/shared/health/zone-minutes'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

type Db = ReturnType<typeof getDb>

// ── Daily Scores ───────────────────────────────────────────────────────────────

export async function upsertOuraDaily(db: Db, userId: string, rows: OuraDailyRow[], source: HealthSource): Promise<void> {
  if (rows.length === 0) return
  await db
    .insert(s.ouraDaily)
    .values(rows.map(r => {
     const v = {
      userId,
      date: r.date,
      readinessScore:            r.readinessScore            ?? null,
      temperatureDeviation:      r.temperatureDeviation      ?? null,
      temperatureTrendDeviation: r.temperatureTrendDeviation ?? null,
      readinessContributors:     r.readinessContributors     ?? null,
      sleepScore:                r.sleepScore                ?? null,
      sleepContributors:         r.sleepContributors         ?? null,
      activityScore:             r.activityScore             ?? null,
      activeCalories:            r.activeCalories            ?? null,
      totalCalories:             r.totalCalories             ?? null,
      equivalentWalkingDistance: r.equivalentWalkingDistance ?? null,
      highActivityTimeSec:       r.highActivityTimeSec       ?? null,
      mediumActivityTimeSec:     r.mediumActivityTimeSec     ?? null,
      lowActivityTimeSec:        r.lowActivityTimeSec        ?? null,
      sedentaryTimeSec:          r.sedentaryTimeSec          ?? null,
      nonWearTimeSec:            r.nonWearTimeSec            ?? null,
      activityContributors:      r.activityContributors      ?? null,
      restingTimeSec:            r.restingTimeSec            ?? null,
      avgMetMinutes:             r.avgMetMinutes             ?? null,
      highActivityMetMinutes:    r.highActivityMetMinutes    ?? null,
      mediumActivityMetMinutes:  r.mediumActivityMetMinutes  ?? null,
      lowActivityMetMinutes:     r.lowActivityMetMinutes     ?? null,
      stressHigh:                r.stressHigh               ?? null,
      recoveryHigh:              r.recoveryHigh             ?? null,
      daySummary:                r.daySummary               ?? null,
      vo2Max:                    r.vo2Max                   ?? null,
      vascularAge:               r.vascularAge              ?? null,
      pulseWaveVelocity:         r.pulseWaveVelocity        ?? null,
      resilienceLevel:           r.resilienceLevel          ?? null,
      resilienceContributors:    r.resilienceContributors   ?? null,
      recommendedBedtimeStart:   r.recommendedBedtimeStart  ?? null,
      recommendedBedtimeEnd:     r.recommendedBedtimeEnd    ?? null,
      sleepTimeStatus:           r.sleepTimeStatus          ?? null,
      sleepTimeRecommendation:   r.sleepTimeRecommendation  ?? null,
      breathingDisturbanceIndex: r.breathingDisturbanceIndex ?? null,
     }
     return { ...v, sourceMap: initialSourceMap(OURA_DAILY_SOURCE_COLS, v, source) }
    }))
    .onConflictDoUpdate({
      target: [s.ouraDaily.userId, s.ouraDaily.date],
      set: {
        ...mergeSet('oura_daily', OURA_DAILY_SOURCE_COLS, source),
        syncedAt: sql`NOW()`,
      },
    })
}

export async function getOuraDaily(db: Db, userId: string, startDate: string, endDate: string): Promise<OuraDailyRow[]> {
  const rows = await db
    .select()
    .from(s.ouraDaily)
    .where(and(
      eq(s.ouraDaily.userId, userId),
      gte(s.ouraDaily.date, startDate),
      lte(s.ouraDaily.date, endDate),
    ))
    .orderBy(asc(s.ouraDaily.date))
  return rows.map(r => ({
    date:                      r.date,
    readinessScore:            r.readinessScore,
    temperatureDeviation:      r.temperatureDeviation,
    temperatureTrendDeviation: r.temperatureTrendDeviation,
    readinessContributors:     r.readinessContributors as Record<string, number | null> | null,
    sleepScore:                r.sleepScore,
    sleepContributors:         r.sleepContributors as Record<string, number | null> | null,
    activityScore:             r.activityScore,
    activeCalories:            r.activeCalories,
    totalCalories:             r.totalCalories,
    equivalentWalkingDistance: r.equivalentWalkingDistance,
    highActivityTimeSec:       r.highActivityTimeSec,
    mediumActivityTimeSec:     r.mediumActivityTimeSec,
    lowActivityTimeSec:        r.lowActivityTimeSec,
    sedentaryTimeSec:          r.sedentaryTimeSec,
    nonWearTimeSec:            r.nonWearTimeSec,
    activityContributors:      r.activityContributors as Record<string, number | null> | null,
    restingTimeSec:            r.restingTimeSec,
    avgMetMinutes:             r.avgMetMinutes,
    highActivityMetMinutes:    r.highActivityMetMinutes,
    mediumActivityMetMinutes:  r.mediumActivityMetMinutes,
    lowActivityMetMinutes:     r.lowActivityMetMinutes,
    stressHigh:                r.stressHigh,
    recoveryHigh:              r.recoveryHigh,
    daySummary:                r.daySummary,
    vo2Max:                    r.vo2Max,
    vascularAge:               r.vascularAge,
    pulseWaveVelocity:         r.pulseWaveVelocity,
    resilienceLevel:           r.resilienceLevel,
    resilienceContributors:    r.resilienceContributors as Record<string, number | null> | null,
    recommendedBedtimeStart:   r.recommendedBedtimeStart,
    recommendedBedtimeEnd:     r.recommendedBedtimeEnd,
    sleepTimeStatus:           r.sleepTimeStatus,
    sleepTimeRecommendation:   r.sleepTimeRecommendation,
    breathingDisturbanceIndex: r.breathingDisturbanceIndex,
  }))
}

/** The most recent oura_daily row carrying VO₂ max / vascular age — necessarily
 *  pre-re-key (Cloud-only fields, frozen since 2026-07-07). Returned WITH its date
 *  so the UI can stamp "as of <day>" instead of presenting it as current. */
export async function getLatestOuraCloudVitals(
  db: Db, userId: string,
): Promise<{ date: string; vo2Max: number | null; vascularAge: number | null } | null> {
  const rows = await db
    .select({ date: s.ouraDaily.date, vo2Max: s.ouraDaily.vo2Max, vascularAge: s.ouraDaily.vascularAge })
    .from(s.ouraDaily)
    .where(and(
      eq(s.ouraDaily.userId, userId),
      or(isNotNull(s.ouraDaily.vo2Max), isNotNull(s.ouraDaily.vascularAge)),
    ))
    .orderBy(desc(s.ouraDaily.date))
    .limit(1)
  return rows[0] ?? null
}

export async function getLatestOuraBleMeasuredAt(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ measuredAt: s.ouraRawSamples.measuredAt })
    .from(s.ouraRawSamples)
    .where(and(eq(s.ouraRawSamples.userId, userId), isNotNull(s.ouraRawSamples.measuredAt)))
    .orderBy(desc(s.ouraRawSamples.measuredAt))
    .limit(1)
  return row?.measuredAt ?? null
}

export async function listOuraTags(db: Db, userId: string, startDay: string, endDay: string): Promise<OuraTagRow[]> {
  const rows = await db
    .select()
    .from(s.ouraTags)
    .where(and(
      eq(s.ouraTags.userId, userId),
      gte(s.ouraTags.startDay, startDay),
      lte(s.ouraTags.startDay, endDay),
    ))
    .orderBy(asc(s.ouraTags.startTime))
  return rows.map(r => ({
    ouraId:     r.ouraId,
    source:     r.source as OuraTagRow['source'],
    tagType:    r.tagType,
    customName: r.customName,
    comment:    r.comment,
    mood:       r.mood,
    startDay:   r.startDay,
    endDay:     r.endDay,
    startTime:  r.startTime,
    endTime:    r.endTime,
  }))
}

// ── Sleep ──────────────────────────────────────────────────────────────────────

export async function upsertOuraSleep(db: Db, userId: string, sessions: OuraSleepUpsertRow[], source: HealthSource): Promise<void> {
  if (sessions.length === 0) return
  await db
    .insert(s.sleepSessions)
    .values(sessions.map(r => {
     const v = {
      userId,
      date:             r.date,
      sleepStart:       r.sleepStart,
      sleepEnd:         r.sleepEnd,
      durationHours:    r.durationHours    ?? null,
      deepSleepHours:   r.deepSleepHours   ?? null,
      remSleepHours:    r.remSleepHours    ?? null,
      lightSleepHours:  r.lightSleepHours  ?? null,
      awakHours:        r.awakHours        ?? null,
      ouraId:           r.ouraId          ?? null,
      efficiency:       r.efficiency       ?? null,
      onsetLatencySec:  r.onsetLatencySec  ?? null,
      averageHrvMs:     r.averageHrvMs     ?? null,
      avgHeartRate:     r.avgHeartRate     != null ? Math.round(r.avgHeartRate)     : null,
      lowestHeartRate:  r.lowestHeartRate  != null ? Math.round(r.lowestHeartRate)  : null,
      restlessPeriods:  r.restlessPeriods  ?? null,
      sleepScore:       r.sleepScore       ?? null,
      respiratoryRate:  r.respiratoryRate  ?? null,
      sleepPhase5Min:   r.sleepPhase5Min   ?? null,
      timeInBedHours:   r.timeInBedHours   ?? null,
     }
     return { ...v, sourceMap: initialSourceMap(OURA_SLEEP_SOURCE_COLS, v, source) }
    }))
    // Conflict on (user_id, sleep_start) — handles both:
    // 1. Merging Oura data into an existing Samsung Health row for the same night
    // 2. Re-syncing an existing Oura row (same oura_id → same sleep_start)
    .onConflictDoUpdate({
      target: [s.sleepSessions.userId, s.sleepSessions.sleepStart],
      set: {
        ...mergeSet('sleep_sessions', OURA_SLEEP_SOURCE_COLS, source),
        updatedAt: sql`NOW()`,
      },
    })
}

// ── Heart Rate ─────────────────────────────────────────────────────────────────

// Throttled retention prune — fires at most once per 24h, fire-and-forget.
// 180 days keeps two mesocycles of workout HR detail; derived per-session
// stats live in exercise_logs/set_logs and are unaffected by pruning the raw series.
let lastHeartrateStorePrune = 0
const HR_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

export async function upsertOuraHeartrate(db: Db, userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]) {
  if (rows.length === 0) return
  // Collapse repeats on the conflict target BEFORE the insert. Postgres rejects a whole command
  // whose VALUES list hits the same conflict row twice ("ON CONFLICT DO UPDATE command cannot
  // affect row a second time"), so one duplicated timestamp discarded an entire CHUNK — up to
  // 5,000 points, not just the duplicate. Live in production: the chest strap sent repeats within
  // a second and every batch failed identically on retry, losing those samples permanently
  // (Q-214, 2026-08-13). Last value wins, matching the ON CONFLICT arm's excluded.* semantics.
  // The BLE rollup already merges by timestamp before calling here; this makes the guarantee the
  // function's own, so every caller gets it rather than each one remembering.
  const byTimestamp = new Map<number, { userId: string; timestamp: Date; bpm: number; source: string | null }>()
  for (const r of rows) {
    byTimestamp.set(r.timestamp.getTime(), { userId, timestamp: r.timestamp, bpm: r.bpm, source: r.source })
  }
  const values = Array.from(byTimestamp.values())
  // 4 params/row → chunk well under pg's 65535 bind-parameter ceiling. A BLE
  // rollup can produce thousands of binned rows in one pass.
  const CHUNK = 5000
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(s.ouraHeartrate)
      .values(values.slice(i, i + CHUNK))
      // B1 (Phase-2 durability): DO UPDATE, not DO NOTHING — a re-decoded/corrected bpm at an
      // existing (user, timestamp) must reach the backup, else the Track-B sync never sees the
      // fix (review R1/B1-a). Bump `updated_at` ONLY when bpm/source actually changed (setWhere),
      // so an idempotent re-roll of unchanged points does not churn the timeseries sync. The
      // conflict target is (user_id, timestamp), so the matched row is already user-scoped.
      .onConflictDoUpdate({
        target: [s.ouraHeartrate.userId, s.ouraHeartrate.timestamp],
        set: { bpm: sql`excluded.bpm`, source: sql`excluded.source`, updatedAt: sql`now()` },
        setWhere: sql`${s.ouraHeartrate.bpm} IS DISTINCT FROM excluded.bpm OR ${s.ouraHeartrate.source} IS DISTINCT FROM excluded.source`,
      })
  }

  const now = Date.now()
  if (shouldPrune(lastHeartrateStorePrune, now, HR_PRUNE_THROTTLE_MS)) {
    lastHeartrateStorePrune = now
    db.execute(sql`DELETE FROM oura_heartrate WHERE timestamp < now() - interval '180 days'`).catch(err => console.error('[prune] oura_heartrate failed:', err))
  }
}

// ── Coarse trend buckets (RRD ladder) ─────────────────────────────────────────
// B1 (Phase-2 durability): the durable server backup of the on-device `oura_bucket`
// coarse tiers. Device-computed, never server-computed. Forever-retained (no prune).

export interface OuraBucketRow {
  tier: string
  bucketStartMs: number
  bucketStartDs: number
  localDate: string
  hrMean: number | null
  hrMin: number | null
  hrMax: number | null
  hrvRmssdMs: number | null
  spo2Pct: number | null
  perfusionIndex: number | null
  skinTempC: number | null
  metMean: number | null
  metMinutes: number | null
  motionMad: number | null
  ibiMs: string | null
  sampleCount: number | null
}

export async function upsertOuraBucket(db: Db, userId: string, rows: OuraBucketRow[]) {
  if (rows.length === 0) return
  const values = rows.map(r => ({ userId, ...r }))
  // ~17 cols/row → stay well under pg's 65535 bind-parameter ceiling.
  const CHUNK = 2000
  // Bump `updated_at` ONLY when a metric actually changed, so an idempotent re-roll of the
  // forever-retained tiers doesn't churn the Track-B sync (every re-roll would otherwise
  // re-sync every bucket). Conflict target (user_id, tier, bucket_start_ms) is user-scoped.
  const changed = sql`
    ${s.ouraBucket.bucketStartDs} IS DISTINCT FROM excluded.bucket_start_ds OR
    ${s.ouraBucket.localDate} IS DISTINCT FROM excluded.local_date OR
    ${s.ouraBucket.hrMean} IS DISTINCT FROM excluded.hr_mean OR
    ${s.ouraBucket.hrMin} IS DISTINCT FROM excluded.hr_min OR
    ${s.ouraBucket.hrMax} IS DISTINCT FROM excluded.hr_max OR
    ${s.ouraBucket.hrvRmssdMs} IS DISTINCT FROM excluded.hrv_rmssd_ms OR
    ${s.ouraBucket.spo2Pct} IS DISTINCT FROM excluded.spo2_pct OR
    ${s.ouraBucket.perfusionIndex} IS DISTINCT FROM excluded.perfusion_index OR
    ${s.ouraBucket.skinTempC} IS DISTINCT FROM excluded.skin_temp_c OR
    ${s.ouraBucket.metMean} IS DISTINCT FROM excluded.met_mean OR
    ${s.ouraBucket.metMinutes} IS DISTINCT FROM excluded.met_minutes OR
    ${s.ouraBucket.motionMad} IS DISTINCT FROM excluded.motion_mad OR
    ${s.ouraBucket.ibiMs} IS DISTINCT FROM excluded.ibi_ms OR
    ${s.ouraBucket.sampleCount} IS DISTINCT FROM excluded.sample_count`
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insert(s.ouraBucket)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [s.ouraBucket.userId, s.ouraBucket.tier, s.ouraBucket.bucketStartMs],
        set: {
          bucketStartDs: sql`excluded.bucket_start_ds`,
          localDate: sql`excluded.local_date`,
          hrMean: sql`excluded.hr_mean`,
          hrMin: sql`excluded.hr_min`,
          hrMax: sql`excluded.hr_max`,
          hrvRmssdMs: sql`excluded.hrv_rmssd_ms`,
          spo2Pct: sql`excluded.spo2_pct`,
          perfusionIndex: sql`excluded.perfusion_index`,
          skinTempC: sql`excluded.skin_temp_c`,
          metMean: sql`excluded.met_mean`,
          metMinutes: sql`excluded.met_minutes`,
          motionMad: sql`excluded.motion_mad`,
          ibiMs: sql`excluded.ibi_ms`,
          sampleCount: sql`excluded.sample_count`,
          updatedAt: sql`now()`,
        },
        setWhere: changed,
      })
  }
}

// ── Track-B dedicated timeseries pull (B2) ────────────────────────────────────
// The high-volume Oura time-series (`oura_heartrate` ~288 pts/day; coarse `oura_bucket`)
// do NOT ride the shared `getSyncDelta` Promise.all fan-out — a 100-page restore there
// would monopolise the pool (the I19 lesson, adapter.ts single-connection rollup fix).
// This dedicated pull serves BOTH tables on ONE checked-out connection (never a
// Promise.all of two pooled reads) with a keyset `(updated_at, id)` cursor.
//
// The keyset cursor is exact — safe here precisely because this is single-domain per
// query (one id-space, no cross-domain comparison), so it needs none of the shared
// scalar cursor's lossy `−1ms` overlap. Rows sharing one `updated_at` (e.g. a whole
// rollup chunk stamped with the same `now()`) are disambiguated by `id` and drain fully
// across pages — the shared scalar cursor would stall on exactly that batch. This is why
// the keyset lives ONLY in this endpoint and `lib/sync/cursor.ts` stays unchanged.
//
// Retention: HR is a rolling 180-day window (prune in upsertOuraHeartrate); coarse
// buckets are forever-retained. The server `oura_bucket` table is device-fed (coarse
// tiers only, by construction) so no tier filter is needed.
export interface TimeseriesCursor { updatedAt: string; id: string }
export interface TimeseriesPage<T> { rows: T[]; cursor: TimeseriesCursor | null; hasMore: boolean }

export interface OuraHrDeltaRow {
  id: string; timestamp: string; bpm: number; source: string | null; updatedAt: string
}
export interface OuraBucketDeltaRow extends OuraBucketRow { id: string; updatedAt: string }

// Per-domain page budget. A full-history restore drains ~54k HR rows in ~54000/2000 ≈ 27
// pages; a single response is bounded so no request returns an unbounded payload.
export const TIMESERIES_ROW_BUDGET = 2000

async function pullKeyset<T>(
  client: import('pg').PoolClient,
  table: 'oura_heartrate' | 'oura_bucket',
  columns: string,
  userId: string,
  cursor: TimeseriesCursor | null,
  budget: number,
  map: (row: Record<string, unknown>) => T,
): Promise<TimeseriesPage<T>> {
  // Keyset paging: (updated_at > ts) OR (updated_at = ts AND id > id). A null cursor
  // (first page / full restore) matches all rows. Uses the (user_id, updated_at, id)
  // index added in migrations 130/137.
  const { rows } = await client.query(
    `SELECT ${columns}, updated_at AS "updatedAt"
       FROM ${table}
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL
             OR updated_at > $2::timestamptz
             OR (updated_at = $2::timestamptz AND id > $3::uuid))
      ORDER BY updated_at ASC, id ASC
      LIMIT $4::int`,
    [userId, cursor?.updatedAt ?? null, cursor?.id ?? null, budget],
  )
  const mapped = rows.map(map)
  const last = rows.length ? rows[rows.length - 1] as { id: string; updatedAt: string | Date } : null
  return {
    rows: mapped,
    // On an empty page keep the caller's cursor so the client can blindly persist
    // response.cursor without a null overwriting a real position.
    cursor: last ? { updatedAt: new Date(last.updatedAt).toISOString(), id: last.id } : cursor,
    hasMore: rows.length === budget,
  }
}

/**
 * Track-B's dedicated timeseries pull: intraday HR and coarse buckets, by keyset cursor.
 *
 * **It has no production caller, and that is a decision rather than an oversight (Q-180, decided
 * 2026-08-14).** Its only caller was `/api/sync/oura-timeseries`, deleted with owner approval in
 * Q-136 — a route that had sat unreachable since it was written, because the client driver it
 * needed was never built (`restoreFromCloud` says so in its own doc comment).
 *
 * Kept, on three measured facts rather than a preference:
 *
 *  1. `ouraHeartrate` appears **nowhere** in `SyncDelta`. Intraday HR reaches a fresh device by no
 *     other path — `restoreFromCloud` drains only the day-grained delta.
 *  2. The **server** is the archive: the owner's 2026-08-02 retention decision makes the
 *     device-local raw store a 14-day rolling window, so a re-install or a new phone loses intraday
 *     history that still exists server-side.
 *  3. It costs nothing at runtime, and the stated direction is multi-device.
 *
 * So whoever writes the restore driver has the DB half waiting, proven by
 * `__tests__/oura-timeseries-pull.test.ts`. **This comment is the point of the decision** — the
 * entry's real complaint was that an uncalled method costs a paragraph in every dead-code sweep.
 * Re-litigate it only if the device stops needing a cloud restore of intraday HR.
 */
export async function getOuraTimeseriesDelta(
  userId: string,
  opts: { heartrate?: TimeseriesCursor | null; bucket?: TimeseriesCursor | null; budget?: number },
): Promise<{ heartrate: TimeseriesPage<OuraHrDeltaRow>; bucket: TimeseriesPage<OuraBucketDeltaRow> }> {
  const budget = Math.min(Math.max(1, opts.budget ?? TIMESERIES_ROW_BUDGET), TIMESERIES_ROW_BUDGET)
  const pool = getPool()
  const client = await pool.connect()
  try {
    // Sequential on the SAME connection — never Promise.all (that checks out two pooled
    // connections at once and can starve the pool under a concurrent restore loop).
    const heartrate = await pullKeyset<OuraHrDeltaRow>(
      client, 'oura_heartrate', 'id, timestamp, bpm, source', userId, opts.heartrate ?? null, budget,
      (r) => ({
        id: r.id as string,
        timestamp: new Date(r.timestamp as string | Date).toISOString(),
        bpm: r.bpm as number,
        source: (r.source as string | null) ?? null,
        updatedAt: new Date(r.updatedAt as string | Date).toISOString(),
      }),
    )
    const bucket = await pullKeyset<OuraBucketDeltaRow>(
      client, 'oura_bucket',
      'id, tier, bucket_start_ms AS "bucketStartMs", bucket_start_ds AS "bucketStartDs", ' +
      'local_date AS "localDate", hr_mean AS "hrMean", hr_min AS "hrMin", hr_max AS "hrMax", ' +
      'hrv_rmssd_ms AS "hrvRmssdMs", spo2_pct AS "spo2Pct", perfusion_index AS "perfusionIndex", ' +
      'skin_temp_c AS "skinTempC", met_mean AS "metMean", met_minutes AS "metMinutes", ' +
      'motion_mad AS "motionMad", ibi_ms AS "ibiMs", sample_count AS "sampleCount"',
      userId, opts.bucket ?? null, budget,
      (r) => ({
        id: r.id as string,
        tier: r.tier as string,
        bucketStartMs: Number(r.bucketStartMs),
        bucketStartDs: Number(r.bucketStartDs),
        localDate: r.localDate as string,
        hrMean: r.hrMean as number | null,
        hrMin: r.hrMin as number | null,
        hrMax: r.hrMax as number | null,
        hrvRmssdMs: r.hrvRmssdMs as number | null,
        spo2Pct: r.spo2Pct as number | null,
        perfusionIndex: r.perfusionIndex as number | null,
        skinTempC: r.skinTempC as number | null,
        metMean: r.metMean as number | null,
        metMinutes: r.metMinutes as number | null,
        motionMad: r.motionMad as number | null,
        ibiMs: (r.ibiMs as string | null) ?? null,
        sampleCount: r.sampleCount as number | null,
        updatedAt: new Date(r.updatedAt as string | Date).toISOString(),
      }),
    )
    return { heartrate, bucket }
  } finally {
    client.release()
  }
}

export async function getHrForWindow(db: Db, userId: string, from: Date, to: Date) {
  const rows = await db
    .select({ timestamp: s.ouraHeartrate.timestamp, bpm: s.ouraHeartrate.bpm, source: s.ouraHeartrate.source })
    .from(s.ouraHeartrate)
    .where(and(
      eq(s.ouraHeartrate.userId, userId),
      gte(s.ouraHeartrate.timestamp, from),
      lte(s.ouraHeartrate.timestamp, to),
    ))
    .orderBy(asc(s.ouraHeartrate.timestamp))
  return preferStrapBuckets(rows)
}

// ── Time-in-HR-zone rollup cache (daily_zone_minutes, migration 129) ──────────────────────
// Server-side derived cache: recomputed on read from oura_heartrate via the pure zone-minutes
// primitive. NOT an offline-first user-write domain (no local store / outbox).

export interface DayZoneSeconds { day: string; seconds: [number, number, number, number, number] }

/** Compute one local day's zone-seconds from stored HR, using the caller's zone profile. Pure DB
 *  read → primitive; no persistence here. */
export async function computeDayZoneSeconds(
  db: Db, userId: string, day: string, tz: string,
  profile: { maxHr: number; restingHr: number },
): Promise<[number, number, number, number, number]> {
  const from = fromZonedTime(`${day}T00:00:00`, tz)
  const to = fromZonedTime(`${day}T23:59:59`, tz)
  const rows = await getHrForWindow(db, userId, from, to)
  const readings: HrReading[] = rows.map(r => ({
    timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).getTime(),
    bpm: r.bpm,
  }))
  const zones = computeHrZones(profile)
  return accumulateZoneSeconds(readings, zones) as [number, number, number, number, number]
}

// Inclusive YYYY-MM-DD day iterator using Date.UTC overflow normalisation (never string-splice
// arithmetic — see the Date Arithmetic rule).
function eachDay(fromDay: string, toDay: string): string[] {
  const out: string[] = []
  const [fy, fm, fd] = fromDay.split('-').map(Number)
  const [ty, tm, td] = toDay.split('-').map(Number)
  let cur = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  while (cur <= end) {
    const dt = new Date(cur)
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`)
    cur += 86_400_000
  }
  return out
}

// Days older than this can no longer be recomputed — the raw oura_heartrate series is pruned at
// 180 days (upsertOuraHeartrate above). So a cached day past this horizon keeps its frozen split
// even on a profile mismatch: it is the permanent record once HR thins (review H-4, Design §2).
const ZONE_HR_RETENTION_DAYS = 180

/** Delete cached daily_zone_minutes rows for `userId` on/after `fromDay` (inclusive). Called by the
 *  BLE rollup after it delete-and-reinserts oura_heartrate across its window, so those days are
 *  recomputed on the next read instead of serving the pre-rewrite (often partial) split forever
 *  (review J-1/C-5 — the owns-its-rows analogue of a cache-group invalidation). */
export async function deleteZoneMinutesFrom(db: Db, userId: string, fromDay: string): Promise<void> {
  await db.delete(s.dailyZoneMinutes).where(and(
    eq(s.dailyZoneMinutes.userId, userId),
    gte(s.dailyZoneMinutes.day, fromDay),
  ))
}

/** Range of daily zone-seconds with reconcile-on-read caching. `today` (user-local) is always
 *  recomputed (partial day). A cached past day is trusted only when its stamped profile matches the
 *  caller's — a mismatch is recomputed for days still inside HR retention, else served as-is
 *  (frozen-profile record). Missing/stale days are computed concurrently. */
export async function getZoneMinutesRange(
  db: Db, userId: string, fromDay: string, toDay: string, tz: string,
  profile: { maxHr: number; restingHr: number },
): Promise<DayZoneSeconds[]> {
  const today = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const retentionCutoff = shiftDateStr(today, -ZONE_HR_RETENTION_DAYS)
  const cached = await db.select().from(s.dailyZoneMinutes).where(and(
    eq(s.dailyZoneMinutes.userId, userId),
    gte(s.dailyZoneMinutes.day, fromDay),
    lte(s.dailyZoneMinutes.day, toDay),
  ))
  const byDay = new Map(cached.map(r => [r.day, r]))

  const profileMatches = (row: { maxHr: number | null; restingHr: number | null }) =>
    row.maxHr === profile.maxHr && row.restingHr === profile.restingHr

  const days = eachDay(fromDay, toDay)
  // Resolve each day concurrently (the cold path was a serial round-trip per day — C-5 perf face).
  const out = await Promise.all(days.map(async (day): Promise<DayZoneSeconds> => {
    const row = byDay.get(day)
    if (row && day !== today) {
      // Trust the cache unless the profile drifted AND the day is still recomputable from HR.
      if (profileMatches(row) || day < retentionCutoff) {
        return { day, seconds: [row.zone1Sec, row.zone2Sec, row.zone3Sec, row.zone4Sec, row.zone5Sec] }
      }
    }
    const seconds = await computeDayZoneSeconds(db, userId, day, tz, profile)
    if (day !== today) {
      // Cache past days only (today is partial and re-derived each read). Stamp the profile so a
      // later read under a drifted profile recomputes instead of trusting stale bands.
      const cols = {
        zone1Sec: Math.round(seconds[0]), zone2Sec: Math.round(seconds[1]), zone3Sec: Math.round(seconds[2]),
        zone4Sec: Math.round(seconds[3]), zone5Sec: Math.round(seconds[4]),
        maxHr: profile.maxHr, restingHr: profile.restingHr,
      }
      await db.insert(s.dailyZoneMinutes).values({ userId, day, ...cols }).onConflictDoUpdate({
        target: [s.dailyZoneMinutes.userId, s.dailyZoneMinutes.day],
        set: { ...cols, computedAt: new Date() },
      })
    }
    return { day, seconds }
  }))
  return out
}

// Throttled retention prune (review H-1/G-6, Design-notes Lever R) — the only prior gap where a
// bounded sample series had NO retention bound (its sibling oura_heartrate prunes at 180d). 90 days
// keeps a whole training block re-analysable with better rest-window logic before thinning. Safe
// because the sole reader (hr-data:26) recomputes workout_hrv_ms, which Lever W now snapshots into
// workout_hr_stats — so a pruned beat older than 90d costs nothing the recap still needs.
let lastRrIntervalsPrune = 0
const RR_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

export async function insertRrIntervals(db: Db, userId: string, rows: { at: Date; rrMs: number }[]) {
  if (rows.length === 0) return
  await db.insert(s.rrIntervals)
    .values(rows.map(r => ({ userId, at: r.at, rrMs: r.rrMs })))
    .onConflictDoNothing()

  const now = Date.now()
  if (shouldPrune(lastRrIntervalsPrune, now, RR_PRUNE_THROTTLE_MS)) {
    lastRrIntervalsPrune = now
    db.execute(sql`DELETE FROM rr_intervals WHERE at < now() - interval '90 days'`).catch(err => console.error('[prune] rr_intervals failed:', err))
  }
}

export async function getRrForWindow(db: Db, userId: string, from: Date, to: Date) {
  return db
    .select({ at: s.rrIntervals.at, rrMs: s.rrIntervals.rrMs })
    .from(s.rrIntervals)
    .where(and(
      eq(s.rrIntervals.userId, userId),
      gte(s.rrIntervals.at, from),
      lte(s.rrIntervals.at, to),
    ))
    .orderBy(asc(s.rrIntervals.at))
}

// ── D5 — own daytime-HRV model (migration 145) ────────────────────────────────

export async function getDaytimeHrvModel(db: Db, userId: string): Promise<DaytimeHrvModelRow | null> {
  const [row] = await db
    .select({
      intercept: s.ouraDaytimeHrvModel.intercept,
      hrCoef: s.ouraDaytimeHrvModel.hrCoef,
      tempCoef: s.ouraDaytimeHrvModel.tempCoef,
      residualStd: s.ouraDaytimeHrvModel.residualStd,
      nSamples: s.ouraDaytimeHrvModel.nSamples,
      fittedAt: s.ouraDaytimeHrvModel.fittedAt,
    })
    .from(s.ouraDaytimeHrvModel)
    .where(eq(s.ouraDaytimeHrvModel.userId, userId))
  return row ?? null
}

export async function upsertDaytimeHrvModel(db: Db, userId: string, model: {
  intercept: number; hrCoef: number; tempCoef: number; residualStd: number; nSamples: number
}): Promise<void> {
  await db.insert(s.ouraDaytimeHrvModel)
    .values({ userId, ...model, fittedAt: new Date() })
    .onConflictDoUpdate({
      target: s.ouraDaytimeHrvModel.userId,
      set: { intercept: model.intercept, hrCoef: model.hrCoef, tempCoef: model.tempCoef, residualStd: model.residualStd, nSamples: model.nSamples, fittedAt: new Date() },
    })
}

// ── Per-workout HR summary snapshot (migration 135, review H-3 / Lever W) ─────────

/** Persist a workout's durable HR summary. COALESCE upsert gated on readings_count: a partial early
 *  compute (fewer readings — e.g. a recap opened mid-drain) never clobbers a later fuller one, and a
 *  later compute that gained a value (rr arrived, so workout_hrv_ms goes non-null) fills the gap
 *  without wiping fields it lost. */
export async function upsertWorkoutHrStats(db: Db, userId: string, sessionId: string, stats: WorkoutHrStatsInput): Promise<void> {
  await db.insert(s.workoutHrStats)
    .values({
      workoutSessionId: sessionId,
      userId,
      ...stats,
      // `workout_hrv_ms` is the only integer HRV column in the schema — every sibling
      // (sleep_sessions.average_hrv_ms, oura_daily_derived.hrv_rmssd_ms, …) is doublePrecision.
      // rmssdFromRr returns Math.sqrt(mean), so the value arrives fractional and node-postgres
      // sends it as text: Postgres then rejects the WHOLE insert with `invalid input syntax for
      // type integer: "38.42156862745098"`. Caught by the caller's fire-and-forget .catch, so the
      // recap rendered fine and the table stayed at 0 rows for every session ever logged while its
      // sibling set_hr_stats — same block, same call site, but with no HRV column — reached 582.
      workoutHrvMs: stats.workoutHrvMs == null ? null : Math.round(stats.workoutHrvMs),
    })
    .onConflictDoUpdate({
      target: s.workoutHrStats.workoutSessionId,
      set: {
        avgBpm:        sql`COALESCE(excluded.avg_bpm, ${s.workoutHrStats.avgBpm})`,
        peakBpm:       sql`COALESCE(excluded.peak_bpm, ${s.workoutHrStats.peakBpm})`,
        hrr1Best:      sql`COALESCE(excluded.hrr1_best, ${s.workoutHrStats.hrr1Best})`,
        workoutHrvMs:  sql`COALESCE(excluded.workout_hrv_ms, ${s.workoutHrStats.workoutHrvMs})`,
        readingsCount: sql`GREATEST(excluded.readings_count, ${s.workoutHrStats.readingsCount})`,
        source:        sql`COALESCE(excluded.source, ${s.workoutHrStats.source})`,
        computedAt:    new Date(),
      },
      setWhere: sql`excluded.readings_count >= ${s.workoutHrStats.readingsCount}`,
    })
}

export async function getWorkoutHrStats(db: Db, userId: string, sessionId: string): Promise<WorkoutHrStatsRow | null> {
  const [row] = await db
    .select({
      avgBpm: s.workoutHrStats.avgBpm, peakBpm: s.workoutHrStats.peakBpm, hrr1Best: s.workoutHrStats.hrr1Best,
      workoutHrvMs: s.workoutHrStats.workoutHrvMs, readingsCount: s.workoutHrStats.readingsCount,
      source: s.workoutHrStats.source, computedAt: s.workoutHrStats.computedAt,
    })
    .from(s.workoutHrStats)
    .where(and(eq(s.workoutHrStats.userId, userId), eq(s.workoutHrStats.workoutSessionId, sessionId)))
    .limit(1)
  return row ?? null
}

/** Completed sessions (inside the retention window) that still have no *usable* snapshot — the
 *  Lever W backfill work-list. Ordered oldest-first so a bounded admin pass drains the ones nearest
 *  the 180d prune edge first.
 *
 *  Coverage-aware (Q-11 Defect B): a snapshot row with `readingsCount = 0` also counts as missing.
 *  Without this, a completion-time compute that runs before the HR data has landed (the ring drains
 *  later; see app/api/complete-workout/route.ts) would persist an empty snapshot and permanently
 *  remove the session from this list — the fuller-wins upsert protects the *values* from a partial
 *  write, but a plain existence check doesn't protect the *work-list* from one. */
export async function listSessionsMissingHrStats(db: Db, userId: string, since: Date, limit: number) {
  return db
    .select({ id: s.workoutSessions.id, startedAt: s.workoutSessions.startedAt, completedAt: s.workoutSessions.completedAt })
    .from(s.workoutSessions)
    .leftJoin(s.workoutHrStats, eq(s.workoutHrStats.workoutSessionId, s.workoutSessions.id))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      isNotNull(s.workoutSessions.completedAt),
      isNull(s.workoutSessions.deletedAt),
      gte(s.workoutSessions.startedAt, since),
      or(
        isNull(s.workoutHrStats.workoutSessionId),
        eq(s.workoutHrStats.readingsCount, 0),
      ),
    ))
    .orderBy(asc(s.workoutSessions.startedAt))
    .limit(limit)
}

// ── Per-SET HR metric snapshot (migration 139, plan 2026-07-21-per-set-hr-metrics) ─────────

/** The logged sets of a session with the identity + prescription dimensions the per-set HR formula
 *  needs (exercise identity, phase, actual/planned %1RM, rest, per-set timing). */
export async function getSetDetailsForSession(db: Db, workoutSessionId: string): Promise<RichSetMarker[]> {
  const rows = await db
    .select({
      setLogId:       s.setLogs.id,
      exerciseLogId:  s.exerciseLogs.id,
      exerciseId:     s.exerciseLogs.exerciseId,
      exerciseName:   s.exerciseLogs.exerciseName,
      setNumber:      s.setLogs.setNumber,
      phaseType:      s.workoutSessions.phaseType,
      intensityPct:   s.setLogs.intensityPct,
      plannedPct:     s.setLogs.plannedPct,
      plannedReps:    s.setLogs.plannedReps,
      restTakenSec:   s.setLogs.restTimeSec,
      plannedRestSec: s.setLogs.plannedRestSec,
      setStartMs:     s.setLogs.setStartMs,
      setEndMs:       s.setLogs.setEndMs,
      updatedAt:      s.setLogs.updatedAt,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
    .where(and(
      eq(s.exerciseLogs.workoutSessionId, workoutSessionId),
      isNull(s.setLogs.deletedAt),
      isNull(s.exerciseLogs.deletedAt),
    ))
    .orderBy(asc(s.setLogs.updatedAt))
  return rows.map(r => ({
    setLogId:       r.setLogId,
    exerciseLogId:  r.exerciseLogId,
    exerciseId:     r.exerciseId,
    exerciseName:   r.exerciseName,
    setNumber:      r.setNumber,
    phaseType:      r.phaseType,
    intensityPct:   r.intensityPct,
    plannedPct:     r.plannedPct,
    plannedReps:    r.plannedReps,
    restTakenSec:   r.restTakenSec,
    plannedRestSec: r.plannedRestSec,
    setStartMs:     r.setStartMs,
    setEndMs:       r.setEndMs,
    loggedAt:       r.setEndMs != null ? new Date(r.setEndMs) : r.updatedAt,
  }))
}

/** Batch persist per-set HR snapshots. COALESCE upsert gated on readings_count, exactly like
 *  workout_hr_stats: a partial early recompute (recap opened mid-drain) never clobbers a later fuller
 *  one; a later fuller compute that gained a value fills the gap without wiping fields it lost. */
export async function upsertSetHrStats(db: Db, userId: string, workoutSessionId: string, rows: SetHrRow[]): Promise<void> {
  if (!rows.length) return
  await db.insert(s.setHrStats)
    .values(rows.map(r => ({
      setLogId: r.setLogId, userId, workoutSessionId,
      exerciseLogId: r.exerciseLogId, exerciseId: r.exerciseId, exerciseName: r.exerciseName,
      phaseType: r.phaseType, setNumber: r.setNumber,
      intensityPct: r.intensityPct, plannedPct: r.plannedPct, plannedReps: r.plannedReps,
      restTakenSec: r.restTakenSec, plannedRestSec: r.plannedRestSec, loggedAt: r.loggedAt,
      peakBpm: r.peakBpm, avgBpm: r.avgBpm, bpmAtEnd: r.bpmAtEnd,
      drop30s: r.drop30s, drop60s: r.drop60s, drop90s: r.drop90s, drop120s: r.drop120s,
      troughBpm: r.troughBpm,
      secToPreset: r.secToPreset, recoveredPreset: r.recoveredPreset,
      secToResting: r.secToResting, recoveredResting: r.recoveredResting,
      pctHrrAtRestEnd: r.pctHrrAtRestEnd, secToHrr50: r.secToHrr50,
      restAdequate: r.restAdequate, readingsCount: r.readingsCount, coverageOk: r.coverageOk,
      source: r.source,
    })))
    .onConflictDoUpdate({
      target: s.setHrStats.setLogId,
      set: {
        peakBpm:         sql`COALESCE(excluded.peak_bpm, ${s.setHrStats.peakBpm})`,
        avgBpm:          sql`COALESCE(excluded.avg_bpm, ${s.setHrStats.avgBpm})`,
        bpmAtEnd:        sql`COALESCE(excluded.bpm_at_end, ${s.setHrStats.bpmAtEnd})`,
        drop30s:         sql`COALESCE(excluded.drop_30s, ${s.setHrStats.drop30s})`,
        drop60s:         sql`COALESCE(excluded.drop_60s, ${s.setHrStats.drop60s})`,
        drop90s:         sql`COALESCE(excluded.drop_90s, ${s.setHrStats.drop90s})`,
        drop120s:        sql`COALESCE(excluded.drop_120s, ${s.setHrStats.drop120s})`,
        troughBpm:       sql`COALESCE(excluded.trough_bpm, ${s.setHrStats.troughBpm})`,
        secToPreset:     sql`COALESCE(excluded.sec_to_preset, ${s.setHrStats.secToPreset})`,
        recoveredPreset: sql`COALESCE(excluded.recovered_preset, ${s.setHrStats.recoveredPreset})`,
        secToResting:    sql`COALESCE(excluded.sec_to_resting, ${s.setHrStats.secToResting})`,
        recoveredResting:sql`COALESCE(excluded.recovered_resting, ${s.setHrStats.recoveredResting})`,
        pctHrrAtRestEnd: sql`COALESCE(excluded.pct_hrr_at_rest_end, ${s.setHrStats.pctHrrAtRestEnd})`,
        secToHrr50:      sql`COALESCE(excluded.sec_to_hrr50, ${s.setHrStats.secToHrr50})`,
        restAdequate:    sql`COALESCE(excluded.rest_adequate, ${s.setHrStats.restAdequate})`,
        readingsCount:   sql`GREATEST(excluded.readings_count, ${s.setHrStats.readingsCount})`,
        coverageOk:      sql`(excluded.coverage_ok OR ${s.setHrStats.coverageOk})`,
        source:          sql`COALESCE(excluded.source, ${s.setHrStats.source})`,
        computedAt:      new Date(),
      },
      setWhere: sql`excluded.readings_count >= ${s.setHrStats.readingsCount}`,
    })
}

function toSetHrStatsRow(r: typeof s.setHrStats.$inferSelect): SetHrStatsRow {
  return {
    setLogId: r.setLogId, workoutSessionId: r.workoutSessionId,
    exerciseLogId: r.exerciseLogId, exerciseId: r.exerciseId, exerciseName: r.exerciseName,
    phaseType: r.phaseType, setNumber: r.setNumber,
    intensityPct: r.intensityPct, plannedPct: r.plannedPct, plannedReps: r.plannedReps,
    restTakenSec: r.restTakenSec, plannedRestSec: r.plannedRestSec, loggedAt: r.loggedAt,
    peakBpm: r.peakBpm, avgBpm: r.avgBpm, bpmAtEnd: r.bpmAtEnd,
    drop30s: r.drop30s, drop60s: r.drop60s, drop90s: r.drop90s, drop120s: r.drop120s,
    troughBpm: r.troughBpm,
    secToPreset: r.secToPreset, recoveredPreset: r.recoveredPreset,
    secToResting: r.secToResting, recoveredResting: r.recoveredResting,
    pctHrrAtRestEnd: r.pctHrrAtRestEnd, secToHrr50: r.secToHrr50,
    restAdequate: r.restAdequate, readingsCount: r.readingsCount, coverageOk: r.coverageOk,
    source: r.source,
    computedAt: r.computedAt,
  }
}

export async function getSetHrStatsForSession(db: Db, userId: string, workoutSessionId: string): Promise<SetHrStatsRow[]> {
  const rows = await db.select().from(s.setHrStats)
    .where(and(eq(s.setHrStats.userId, userId), eq(s.setHrStats.workoutSessionId, workoutSessionId)))
    .orderBy(asc(s.setHrStats.loggedAt), asc(s.setHrStats.setNumber))
  return rows.map(toSetHrStatsRow)
}

/** All per-set HR rows for one exercise since `since`, oldest-first — the per-exercise trend feed.
 *  Matches by exercise id when available, falling back to the denormalised name so library-less
 *  exercises still trend. */
export async function getSetHrStatsForExercise(
  db: Db, userId: string,
  opts: { exerciseId?: string | null; exerciseName?: string; since: Date },
): Promise<SetHrStatsRow[]> {
  const idMatch = opts.exerciseId ? eq(s.setHrStats.exerciseId, opts.exerciseId) : undefined
  const nameMatch = opts.exerciseName ? eq(s.setHrStats.exerciseName, opts.exerciseName) : undefined
  const match = idMatch && nameMatch ? or(idMatch, nameMatch) : (idMatch ?? nameMatch)
  const rows = await db.select().from(s.setHrStats)
    .where(and(
      eq(s.setHrStats.userId, userId),
      gte(s.setHrStats.loggedAt, opts.since),
      match,
    ))
    .orderBy(asc(s.setHrStats.loggedAt), asc(s.setHrStats.setNumber))
  return rows.map(toSetHrStatsRow)
}

/** All of a user's per-set HR rows since `since` (bounded), oldest-first — the cross-exercise feed the
 *  AI chat groups by exercise. Bounded to keep the tool payload sane. */
export async function getSetHrStatsSince(db: Db, userId: string, since: Date, limit = 5000): Promise<SetHrStatsRow[]> {
  const rows = await db.select().from(s.setHrStats)
    .where(and(eq(s.setHrStats.userId, userId), gte(s.setHrStats.loggedAt, since)))
    .orderBy(asc(s.setHrStats.loggedAt), asc(s.setHrStats.setNumber))
    .limit(limit)
  return rows.map(toSetHrStatsRow)
}

/** Completed sessions (inside retention) that have logged sets but no *usable* per-set snapshot yet
 *  — the set-stats backfill work-list, oldest-first (drains the ones nearest the 180d prune edge
 *  first).
 *
 *  Coverage-aware (Q-11 Defect B): a session whose every existing row has `readingsCount = 0` also
 *  counts as missing, not just a session with zero rows. A completion-time compute (see
 *  app/api/complete-workout/route.ts) can run before the HR data has landed — the ring drains later
 *  — and its empty rows must not permanently remove the session from this list the way they used
 *  to: `upsertSetHrStats`'s fuller-wins upsert already protects the *values* from being clobbered by
 *  a later partial write, but this list is what decides whether a later, fuller compute is ever
 *  attempted at all. */
export async function listSessionsMissingSetHrStats(db: Db, userId: string, since: Date, limit: number) {
  return db
    .select({ id: s.workoutSessions.id, startedAt: s.workoutSessions.startedAt, completedAt: s.workoutSessions.completedAt })
    .from(s.workoutSessions)
    .innerJoin(s.exerciseLogs, and(eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id), isNull(s.exerciseLogs.deletedAt)))
    .innerJoin(s.setLogs, and(eq(s.setLogs.exerciseLogId, s.exerciseLogs.id), isNull(s.setLogs.deletedAt)))
    .leftJoin(s.setHrStats, eq(s.setHrStats.setLogId, s.setLogs.id))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      isNotNull(s.workoutSessions.completedAt),
      isNull(s.workoutSessions.deletedAt),
      gte(s.workoutSessions.startedAt, since),
    ))
    .groupBy(s.workoutSessions.id, s.workoutSessions.startedAt, s.workoutSessions.completedAt)
    .having(sql`COALESCE(MAX(${s.setHrStats.readingsCount}), 0) = 0`)
    .orderBy(asc(s.workoutSessions.startedAt))
    .limit(limit)
}

// ── Workouts ───────────────────────────────────────────────────────────────────

export async function getOuraWorkouts(db: Db, userId: string, opts: { unreviewed?: boolean; from?: string; to?: string; timezone?: string }) {
  const conditions = [eq(s.ouraWorkouts.userId, userId)]
  if (opts.unreviewed) {
    conditions.push(eq(s.ouraWorkouts.reviewed, false))
    conditions.push(gte(s.ouraWorkouts.day, shiftDateStr(todayInTz(opts.timezone ?? DEFAULT_TZ), -30)))
  }
  if (opts.from) conditions.push(gte(s.ouraWorkouts.day, opts.from))
  if (opts.to) conditions.push(lte(s.ouraWorkouts.day, opts.to))
  const rows = await db.select().from(s.ouraWorkouts)
    .where(and(...conditions))
    .orderBy(desc(s.ouraWorkouts.day))
  return rows.map(r => ({
    id: r.id, day: r.day, activity: r.activity,
    startDatetime: r.startDatetime, endDatetime: r.endDatetime,
    calories: r.calories, distanceM: r.distanceM,
    intensity: r.intensity, source: r.source, reviewed: r.reviewed,
  }))
}

export async function markOuraWorkoutReviewed(db: Db, userId: string, id: string): Promise<void> {
  await db.update(s.ouraWorkouts)
    .set({ reviewed: true })
    .where(and(eq(s.ouraWorkouts.userId, userId), eq(s.ouraWorkouts.id, id)))
}

// ── HR Sync (workout sessions) ─────────────────────────────────────────────────

export async function getSetTimestampsForSession(db: Db, workoutSessionId: string) {
  const rows = await db
    .select({
      exerciseName: s.exerciseLogs.exerciseName,
      setNumber:    s.setLogs.setNumber,
      setStartMs:   s.setLogs.setStartMs,
      setEndMs:     s.setLogs.setEndMs,
      updatedAt:    s.setLogs.updatedAt,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .where(and(eq(s.exerciseLogs.workoutSessionId, workoutSessionId), isNull(s.setLogs.deletedAt), isNull(s.exerciseLogs.deletedAt)))
    .orderBy(asc(s.setLogs.updatedAt))
  return rows.map(r => ({
    exerciseName: r.exerciseName,
    setNumber:    r.setNumber,
    setStartMs:   r.setStartMs,
    setEndMs:     r.setEndMs,
    loggedAt:     r.setEndMs != null ? new Date(r.setEndMs) : r.updatedAt,
  }))
}

export async function markHrSynced(db: Db, workoutSessionId: string) {
  await db
    .update(s.workoutSessions)
    .set({ hrSyncedAt: new Date() })
    .where(eq(s.workoutSessions.id, workoutSessionId))
}

export async function getUnsyncedHrSessionsForDay(db: Db, userId: string, day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const from = aestMidnight(y, m, d)
  const to   = new Date(from.getTime() + 24 * 60 * 60 * 1000)
  return db
    .select({
      id:          s.workoutSessions.id,
      startedAt:   s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      isNotNull(s.workoutSessions.completedAt),
      isNull(s.workoutSessions.hrSyncedAt),
      gte(s.workoutSessions.startedAt, from),
      lt(s.workoutSessions.startedAt, to),
      isNull(s.workoutSessions.deletedAt),
    ))
}

export async function getUnsyncedHrSessions(db: Db, userId: string, from: Date, to: Date) {
  return db
    .select({
      id:          s.workoutSessions.id,
      startedAt:   s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      isNotNull(s.workoutSessions.completedAt),
      isNull(s.workoutSessions.hrSyncedAt),
      gte(s.workoutSessions.startedAt, from),
      lt(s.workoutSessions.startedAt, to),
      isNull(s.workoutSessions.deletedAt),
    ))
}

export async function getWorkoutSessionById(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({
      id:          s.workoutSessions.id,
      startedAt:   s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    })
    .from(s.workoutSessions)
    .where(and(eq(s.workoutSessions.id, id), eq(s.workoutSessions.userId, userId), isNull(s.workoutSessions.deletedAt)))
    .limit(1)
  return row ?? null
}

// ── Oura BLE Phase 5 — per-night daily summary + rolling personal baselines ────

function summaryRowValues(userId: string, r: OuraDailySummaryRow) {
  return {
    userId,
    date:                r.date,
    sleepDurationHours:  r.sleepDurationHours,
    sleepEfficiency:     r.sleepEfficiency,
    deepSleepHours:      r.deepSleepHours,
    remSleepHours:       r.remSleepHours,
    restlessPeriods:     r.restlessPeriods,
    sleepLatencySec:     r.sleepLatencySec,
    hrvAvgMs:            r.hrvAvgMs,
    rhrLowBpm:           r.rhrLowBpm,
    rhrAvgBpm:           r.rhrAvgBpm,
    recoveryIndexHours:  r.recoveryIndexHours,
    tempMeanC:           r.tempMeanC,
    tempDevC:            r.tempDevC,
    metAvg:              r.metAvg,
    breathAvgRpm:        r.breathAvgRpm,
    hrvBaselineMeanX8:   r.hrvBaseline?.meanX8 ?? null,
    hrvBaselineDevX8:    r.hrvBaseline?.devX8 ?? null,
    rhrBaselineMeanX8:   r.rhrBaseline?.meanX8 ?? null,
    rhrBaselineDevX8:    r.rhrBaseline?.devX8 ?? null,
    tempBaselineMeanX8:  r.tempBaseline?.meanX8 ?? null,
    tempBaselineDevX8:   r.tempBaseline?.devX8 ?? null,
    sleepBaselineMeanX8: r.sleepBaseline?.meanX8 ?? null,
    sleepBaselineDevX8:  r.sleepBaseline?.devX8 ?? null,
    metBaselineMeanX8:   r.metBaseline?.meanX8 ?? null,
    metBaselineDevX8:    r.metBaseline?.devX8 ?? null,
    breathBaselineMeanX8: r.breathBaseline?.meanX8 ?? null,
    breathBaselineDevX8:  r.breathBaseline?.devX8 ?? null,
    nHistory:            r.nHistory,
  }
}

/** Full-history replace: delete every summary row and reinsert. Used by the redecode/full-recompute
 *  path only — the incremental windowed rollup uses upsertOuraDailySummary so it never deletes the
 *  older rows it deliberately didn't recompute. */
export async function replaceOuraDailySummary(db: Db, userId: string, rows: OuraDailySummaryRow[]): Promise<void> {
  await db.delete(s.ouraDailySummary).where(eq(s.ouraDailySummary.userId, userId))
  if (rows.length === 0) return
  await db.insert(s.ouraDailySummary).values(rows.map(r => summaryRowValues(userId, r)))
}

/** Window-scoped upsert (on the unique (user_id, date)): rewrites only the given days in place,
 *  leaving every other persisted summary row — and its baseline checkpoint — untouched. The
 *  incremental rollup's write path (review C-1). */
export async function upsertOuraDailySummary(db: Db, userId: string, rows: OuraDailySummaryRow[]): Promise<void> {
  if (rows.length === 0) return
  for (const r of rows) {
    const values = summaryRowValues(userId, r)
    const { userId: _u, date: _d, ...updatable } = values
    await db.insert(s.ouraDailySummary).values(values).onConflictDoUpdate({
      target: [s.ouraDailySummary.userId, s.ouraDailySummary.date],
      set: { ...updatable, updatedAt: new Date() },
    })
  }
}

/** The EMA-fold checkpoint for the incremental rollup: the single most-recent summary row strictly
 *  before `date` (the night before the window). Returns null when none exists (new user / the window
 *  covers all history), in which case the fold replays cold from the window's first night. */
export async function getLatestOuraDailySummaryBefore(db: Db, userId: string, date: string): Promise<OuraDailySummaryRow | null> {
  const [r] = await db
    .select()
    .from(s.ouraDailySummary)
    .where(and(eq(s.ouraDailySummary.userId, userId), lt(s.ouraDailySummary.date, date)))
    .orderBy(desc(s.ouraDailySummary.date))
    .limit(1)
  if (!r) return null
  return {
    date: r.date,
    sleepDurationHours: r.sleepDurationHours, sleepEfficiency: r.sleepEfficiency,
    deepSleepHours: r.deepSleepHours, remSleepHours: r.remSleepHours,
    restlessPeriods: r.restlessPeriods, sleepLatencySec: r.sleepLatencySec,
    hrvAvgMs: r.hrvAvgMs, rhrLowBpm: r.rhrLowBpm, rhrAvgBpm: r.rhrAvgBpm,
    recoveryIndexHours: r.recoveryIndexHours, tempMeanC: r.tempMeanC, tempDevC: r.tempDevC,
    metAvg: r.metAvg, breathAvgRpm: r.breathAvgRpm,
    hrvBaseline:   r.hrvBaselineMeanX8   != null ? { meanX8: r.hrvBaselineMeanX8,   devX8: r.hrvBaselineDevX8   ?? 0 } : null,
    rhrBaseline:   r.rhrBaselineMeanX8   != null ? { meanX8: r.rhrBaselineMeanX8,   devX8: r.rhrBaselineDevX8   ?? 0 } : null,
    tempBaseline:  r.tempBaselineMeanX8  != null ? { meanX8: r.tempBaselineMeanX8,  devX8: r.tempBaselineDevX8  ?? 0 } : null,
    sleepBaseline: r.sleepBaselineMeanX8 != null ? { meanX8: r.sleepBaselineMeanX8, devX8: r.sleepBaselineDevX8 ?? 0 } : null,
    metBaseline:   r.metBaselineMeanX8   != null ? { meanX8: r.metBaselineMeanX8,   devX8: r.metBaselineDevX8   ?? 0 } : null,
    breathBaseline: r.breathBaselineMeanX8 != null ? { meanX8: r.breathBaselineMeanX8, devX8: r.breathBaselineDevX8 ?? 0 } : null,
    nHistory: r.nHistory,
  }
}

export async function getOuraDailySummary(db: Db, userId: string, from: string, to: string): Promise<OuraDailySummaryRow[]> {
  const rows = await db
    .select()
    .from(s.ouraDailySummary)
    .where(and(eq(s.ouraDailySummary.userId, userId), gte(s.ouraDailySummary.date, from), lte(s.ouraDailySummary.date, to)))
    .orderBy(asc(s.ouraDailySummary.date))
  return rows.map(r => ({
    date:               r.date,
    sleepDurationHours: r.sleepDurationHours,
    sleepEfficiency:    r.sleepEfficiency,
    deepSleepHours:     r.deepSleepHours,
    remSleepHours:      r.remSleepHours,
    restlessPeriods:    r.restlessPeriods,
    sleepLatencySec:    r.sleepLatencySec,
    hrvAvgMs:           r.hrvAvgMs,
    rhrLowBpm:          r.rhrLowBpm,
    rhrAvgBpm:          r.rhrAvgBpm,
    recoveryIndexHours: r.recoveryIndexHours,
    tempMeanC:          r.tempMeanC,
    tempDevC:           r.tempDevC,
    metAvg:             r.metAvg,
    breathAvgRpm:       r.breathAvgRpm,
    hrvBaseline:   r.hrvBaselineMeanX8   != null ? { meanX8: r.hrvBaselineMeanX8,   devX8: r.hrvBaselineDevX8   ?? 0 } : null,
    rhrBaseline:   r.rhrBaselineMeanX8   != null ? { meanX8: r.rhrBaselineMeanX8,   devX8: r.rhrBaselineDevX8   ?? 0 } : null,
    tempBaseline:  r.tempBaselineMeanX8  != null ? { meanX8: r.tempBaselineMeanX8,  devX8: r.tempBaselineDevX8  ?? 0 } : null,
    sleepBaseline: r.sleepBaselineMeanX8 != null ? { meanX8: r.sleepBaselineMeanX8, devX8: r.sleepBaselineDevX8 ?? 0 } : null,
    metBaseline:   r.metBaselineMeanX8   != null ? { meanX8: r.metBaselineMeanX8,   devX8: r.metBaselineDevX8   ?? 0 } : null,
    breathBaseline: r.breathBaselineMeanX8 != null ? { meanX8: r.breathBaselineMeanX8, devX8: r.breathBaselineDevX8 ?? 0 } : null,
    nHistory: r.nHistory,
  }))
}

// ── oura_daily_derived (completed-form derived metrics, Sub-plan A) ──────────────────────

// patch key (camelCase) → DB column (snake_case). Controlled constant — safe to interpolate
// into the COALESCE expression via sql.raw. Every writable column of oura_daily_derived.
// Exported so the offline-sync push-branch field-coverage test can assert every derived column is
// carried in the backup payload (a new column added here without updating the pushMutations branch
// would otherwise never back up — the recurring "missed a column" bug class).
export const DERIVED_COLS: Record<keyof OuraDailyDerivedPatch, string> = {
  source: 'source', modelVersions: 'model_versions',
  sleepScore: 'sleep_score', sleepContributors: 'sleep_contributors',
  readinessScore: 'readiness_score', readinessContributors: 'readiness_contributors', readinessSource: 'readiness_source',
  activityScore: 'activity_score', activityContributors: 'activity_contributors', activeCaloriesEst: 'active_calories_est',
  trainingLoadOts: 'training_load_ots', trainingLoadHigh: 'training_load_high',
  recoveryIndexHours: 'recovery_index_hours', wornHoursBle: 'worn_hours_ble', nightHrvBaselineMs: 'night_hrv_baseline_ms',
  illnessFlag: 'illness_flag', illnessScore: 'illness_score', illnessBiomarkers: 'illness_biomarkers',
  daytimeStressScaled: 'daytime_stress_scaled', stressHighMinutes: 'stress_high_minutes', recoveryHighMinutes: 'recovery_high_minutes',
  chronicStressScore: 'chronic_stress_score', chronicStressContributors: 'chronic_stress_contributors', resilienceLevel: 'resilience_level',
  resilienceDailyStress: 'resilience_daily_stress', resilienceDailyRestorativeTime: 'resilience_daily_restorative_time',
  resilienceDailySleepRecovery: 'resilience_daily_sleep_recovery', resilienceGranular: 'resilience_granular', resilienceConfidence: 'resilience_confidence',
  bdiDerived: 'bdi_derived',
  vascularAge: 'vascular_age', pwv: 'pwv', bodyComp: 'body_comp',
}

export async function upsertOuraDailyDerived(db: Db, userId: string, day: string, patch: OuraDailyDerivedPatch): Promise<void> {
  const keys = (Object.keys(DERIVED_COLS) as (keyof OuraDailyDerivedPatch)[]).filter(k => patch[k] !== undefined)
  // Only the provided fields are written; on conflict each keeps its existing value if the new
  // one is null (COALESCE), so a partial recompute never nulls a good value (master §4.1).
  const values: Record<string, unknown> = { userId, day }
  const set: Record<string, unknown> = { updatedAt: new Date(), computedAt: new Date() }
  for (const k of keys) {
    values[k] = patch[k]
    const col = DERIVED_COLS[k]
    set[k] = sql.raw(`COALESCE(excluded.${col}, oura_daily_derived.${col})`)
  }
  await db
    .insert(s.ouraDailyDerived)
    .values(values as typeof s.ouraDailyDerived.$inferInsert)
    .onConflictDoUpdate({ target: [s.ouraDailyDerived.userId, s.ouraDailyDerived.day], set })
}

export async function getOuraDailyDerived(db: Db, userId: string, from: string, to: string): Promise<OuraDailyDerivedRow[]> {
  const rows = await db
    .select()
    .from(s.ouraDailyDerived)
    .where(and(eq(s.ouraDailyDerived.userId, userId), gte(s.ouraDailyDerived.day, from), lte(s.ouraDailyDerived.day, to)))
    .orderBy(asc(s.ouraDailyDerived.day))
  return rows.map(r => ({
    day: r.day,
    source: r.source,
    modelVersions: r.modelVersions,
    sleepScore: r.sleepScore,
    sleepContributors: r.sleepContributors,
    readinessScore: r.readinessScore,
    readinessContributors: r.readinessContributors,
    readinessSource: r.readinessSource,
    activityScore: r.activityScore,
    activityContributors: r.activityContributors,
    activeCaloriesEst: r.activeCaloriesEst,
    trainingLoadOts: r.trainingLoadOts,
    trainingLoadHigh: r.trainingLoadHigh,
    recoveryIndexHours: r.recoveryIndexHours,
    wornHoursBle: r.wornHoursBle,
    nightHrvBaselineMs: r.nightHrvBaselineMs,
    illnessFlag: r.illnessFlag,
    illnessScore: r.illnessScore,
    illnessBiomarkers: r.illnessBiomarkers,
    daytimeStressScaled: r.daytimeStressScaled,
    stressHighMinutes: r.stressHighMinutes,
    recoveryHighMinutes: r.recoveryHighMinutes,
    chronicStressScore: r.chronicStressScore,
    chronicStressContributors: r.chronicStressContributors,
    resilienceLevel: r.resilienceLevel,
    resilienceDailyStress: r.resilienceDailyStress,
    resilienceDailyRestorativeTime: r.resilienceDailyRestorativeTime,
    resilienceDailySleepRecovery: r.resilienceDailySleepRecovery,
    resilienceGranular: r.resilienceGranular,
    resilienceConfidence: r.resilienceConfidence,
    bdiDerived: r.bdiDerived,
    vascularAge: r.vascularAge,
    pwv: r.pwv,
    bodyComp: r.bodyComp,
  }))
}

// Body composition (Sub-plan F §6.1/§7.1): derive fat/lean mass + BMR from every logged
// weight+body-fat row and persist the completed-form snapshot to oura_daily_derived.body_comp.
// Idempotent (COALESCE upsert), self-backfilling (processes all history — body_metrics is one
// row/day, a small table), and re-derivable from the two source columns. Body-comp is NOT
// BLE-derived, so `source = 'derived'`; it never touches the BLE-derived fields on the same row.
const BODY_COMP_MODEL_VERSION = 'atlas_2_1_0'

// DB-footprint readout for the admin console (Sub-plan G-2 / culling): per-table row estimates +
// total bytes for the Oura tables, plus the `oura_raw_samples` decoded-vs-body_hex split so the
// owner can SEE what the culling levers reclaim (decoded is re-derivable; body_hex is archival).
// Read-only, admin-gated. Sizes come from the planner's stats (cheap, approximate); the raw-sample
// column split is an exact scan of the (single-user) table.
const OURA_FOOTPRINT_TABLES = [
  // `oura_raw_packed` (Q-541) is listed beside `oura_raw_samples` deliberately: packing is only
  // observable as the two moving in opposite directions, and this readout is where the owner watches
  // that happen.
  'oura_raw_samples', 'oura_raw_packed', 'oura_accel_chunks', 'oura_heartrate', 'step_live_windows',
  'oura_daily', 'oura_daily_summary', 'oura_daily_derived', 'sleep_sessions', 'body_metrics',
  'oura_tags', 'oura_workouts', 'oura_ble_clock_anchors', 'oura_tokens',
]

export async function getOuraStorageStats(db: Db): Promise<import('../../repository').OuraStorageStats> {
  const tableList = sql.join(OURA_FOOTPRINT_TABLES.map(t => sql`${t}`), sql`, `)
  const sizeRows = (await db.execute(sql`
    SELECT relname AS table, n_live_tup AS rows, pg_total_relation_size(relid) AS bytes
    FROM pg_stat_user_tables
    WHERE relname IN (${tableList})
    ORDER BY pg_total_relation_size(relid) DESC
  `)).rows as { table: string; rows: string | number; bytes: string | number }[]

  const rawRow = ((await db.execute(sql`
    SELECT count(*)::bigint AS total_rows,
           count(*) FILTER (WHERE decoded IS NOT NULL)::bigint AS decoded_rows,
           COALESCE(sum(pg_column_size(decoded)), 0)::bigint AS decoded_bytes,
           COALESCE(sum(pg_column_size(body_hex)), 0)::bigint AS body_hex_bytes
    FROM oura_raw_samples
  `)).rows[0] ?? {}) as Record<string, string | number>

  return {
    tables: sizeRows.map(r => ({ table: r.table, rows: Number(r.rows), bytes: Number(r.bytes) })),
    rawSamples: {
      totalRows: Number(rawRow.total_rows ?? 0),
      decodedRows: Number(rawRow.decoded_rows ?? 0),
      decodedBytes: Number(rawRow.decoded_bytes ?? 0),
      bodyHexBytes: Number(rawRow.body_hex_bytes ?? 0),
    },
  }
}

// Culling Lever 1b — one-off backfill nulling the `decoded` JSONB on rows written before Lever 1a
// (which stops writing it going forward). DATA-DROPPING → admin-triggered only, never auto-run on
// deploy/migration; the owner presses this deliberately, watching the G-2 footprint numbers drop.
// body_hex is never touched (archival, untouched by definition) — every nulled row's decode path
// already falls back to body_hex (proven in Lever 1a). No age cutoff: every row still carrying
// `decoded` predates Lever 1a and is unconditionally safe to null.
// Batched (500 rows/UPDATE, matching redecodeOuraRawSamples's page size) so no single statement can
// exceed the pool's 15s statement_timeout — each batch commits independently (no wrapping
// transaction), so a killed/interrupted run just leaves fewer rows remaining, never rolled back.
// `maxRows` still bounds one call (owner explicitly asked for "all at once" — defaults high enough
// to clear any realistic single-user backlog in one press, while keeping a finite ceiling rather
// than a literal unbounded loop).
export async function nullHistoricalDecoded(
  db: Db, userId: string, maxRows = 1_000_000,
): Promise<{ nulled: number; remaining: number }> {
  const BATCH = 500
  let nulled = 0
  while (nulled < maxRows) {
    const page = await db
      .select({ id: s.ouraRawSamples.id })
      .from(s.ouraRawSamples)
      .where(and(eq(s.ouraRawSamples.userId, userId), isNotNull(s.ouraRawSamples.decoded)))
      .orderBy(asc(s.ouraRawSamples.id))
      .limit(Math.min(BATCH, maxRows - nulled))
    if (page.length === 0) break
    await db.update(s.ouraRawSamples)
      .set({ decoded: null })
      .where(inArray(s.ouraRawSamples.id, page.map(r => r.id)))
    nulled += page.length
  }
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(s.ouraRawSamples)
    .where(and(eq(s.ouraRawSamples.userId, userId), isNotNull(s.ouraRawSamples.decoded)))
  return { nulled, remaining }
}

// Culling Lever 1c — physically reclaim the disk that Lever 1b freed only logically. Nulling the
// `decoded` column (Lever 1b) writes new tuples and leaves the old JSONB-carrying ones as dead
// tuples; autovacuum reclaims that space for internal reuse but never shrinks the table file
// (Postgres MVCC — see docs/oura-ble-operations.md I17). VACUUM FULL rewrites the table into a
// smaller file, returning the space to the OS. It cannot run inside a transaction and takes a brief
// ACCESS EXCLUSIVE lock on the table, so it is admin-triggered only, never automatic. body_hex is
// untouched — no data is dropped, this only compacts. Not scoped to a user: VACUUM is whole-table.
export async function vacuumOuraRawSamples(): Promise<{
  beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number
}> {
  const pool = getPool()
  const client = await pool.connect()
  const sizeOf = async () =>
    Number((await client.query(`SELECT pg_total_relation_size('oura_raw_samples')::bigint AS bytes`)).rows[0]?.bytes ?? 0)
  try {
    const beforeBytes = await sizeOf()
    // VACUUM FULL can outlast the pool's 15s statement_timeout on a large table; lift both timeouts
    // for this session only, then destroy the connection (release(true)) so the pool never hands a
    // timeout-disabled client to normal query traffic.
    await client.query('SET statement_timeout = 0')
    await client.query('SET idle_in_transaction_session_timeout = 0')
    const started = Date.now()
    await client.query('VACUUM (FULL) oura_raw_samples')
    const ms = Date.now() - started
    const afterBytes = await sizeOf()
    return { beforeBytes, afterBytes, reclaimedBytes: Math.max(0, beforeBytes - afterBytes), ms }
  } finally {
    client.release(true)
  }
}

export async function persistBodyCompFromMetrics(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ date: s.bodyMetrics.date, weightKg: s.bodyMetrics.weightKg, bodyFatPct: s.bodyMetrics.bodyFatPct })
    .from(s.bodyMetrics)
    .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg), isNotNull(s.bodyMetrics.bodyFatPct)))
  let written = 0
  for (const r of rows) {
    const snap = bodyCompSnapshot(r.weightKg, r.bodyFatPct)
    if (snap == null) continue
    await upsertOuraDailyDerived(db, userId, r.date, {
      source: 'derived',
      modelVersions: { bodyComp: BODY_COMP_MODEL_VERSION },
      bodyComp: snap,
    })
    written++
  }
  return written
}

/**
 * The app's OWN derived scores for one local day, as persisted by the live routes and the
 * backfill (`oura_daily_derived`).
 *
 * Deliberately NOT `oura_daily`: that table's Cloud columns are frozen since the 2026-07-07 BLE
 * re-key, so reading them for a historical date shows numbers the app never actually served.
 * Deliberately NOT `buildDayAudit` either — that assembles a full audit from 28 days of history
 * across ~13 queries, which is the fan-out shape Q-107 blames for pool exhaustion; a screen the
 * user swipes day-to-day cannot afford it. This is the same value buildDayAudit persists, read
 * back in one query. Returns null when the day was never scored.
 */
export async function getDerivedScoresForDay(
  db: Db, userId: string, day: string,
): Promise<{ sleepScore: number | null; readinessScore: number | null; activityScore: number | null } | null> {
  const rows = await db
    .select({
      sleepScore:     s.ouraDailyDerived.sleepScore,
      readinessScore: s.ouraDailyDerived.readinessScore,
      activityScore:  s.ouraDailyDerived.activityScore,
    })
    .from(s.ouraDailyDerived)
    .where(and(eq(s.ouraDailyDerived.userId, userId), eq(s.ouraDailyDerived.day, day)))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  return { sleepScore: r.sleepScore ?? null, readinessScore: r.readinessScore ?? null, activityScore: r.activityScore ?? null }
}

/**
 * The BLE rollup's durable incremental watermark (migration 184, Q-213 follow-up).
 *
 * Stage 1 narrowed the rollup to the span an ingest touched but held that span in process memory, so
 * every container restart re-derived the full 35-day window once — six minutes of a pegged main
 * thread, measured in production, on every deploy. Persisting it lets a cold start narrow from where
 * the last successful run reached.
 *
 * `lastRolledDs` is a ring deciseconds counter and restarts on a re-key, so the clock `epoch` is
 * stored alongside. `getOuraRollupWatermark` returns null when the stored epoch is not the ring's
 * current one — a counter from a previous epoch is not comparable, and the caller must fall back to
 * the full window rather than narrow against a meaningless number.
 */
export async function setOuraRollupWatermark(db: Db, userId: string, lastRolledDs: number, epoch: number) {
  await db.insert(s.ouraRollupState)
    .values({ userId, lastRolledDs, epoch })
    .onConflictDoUpdate({
      target: s.ouraRollupState.userId,
      set: { lastRolledDs: sql`excluded.last_rolled_ds`, epoch: sql`excluded.epoch`, updatedAt: sql`now()` },
      // Never move the watermark backwards. Runs can finish out of order (a slow full-history
      // redecode landing after a quick incremental one), and a regressed watermark would silently
      // re-roll a span that is already done — wasted work, not lost data, but the whole point of
      // this row is to stop that. A new epoch is the one case that must overwrite regardless, since
      // its counter restarts from a lower number.
      setWhere: sql`${s.ouraRollupState.lastRolledDs} < excluded.last_rolled_ds OR ${s.ouraRollupState.epoch} <> excluded.epoch`,
    })
}

export async function getOuraRollupWatermark(db: Db, userId: string, currentEpoch: number): Promise<number | null> {
  const rows = await db
    .select({ lastRolledDs: s.ouraRollupState.lastRolledDs, epoch: s.ouraRollupState.epoch })
    .from(s.ouraRollupState)
    .where(eq(s.ouraRollupState.userId, userId))
    .limit(1)
  const r = rows[0]
  if (!r) return null
  // A ring re-key restarts ds from zero, so a value from a previous epoch could be arbitrarily
  // larger or smaller than the current counter. Refuse to narrow against it.
  return r.epoch === currentEpoch ? r.lastRolledDs : null
}
