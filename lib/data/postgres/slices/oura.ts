import { eq, and, or, gte, lte, lt, asc, desc, isNotNull, isNull, inArray, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { getPool } from '../client'
import * as s from '../schema'
import type { OuraWorkout } from '@/lib/oura/types'
import type { OuraDailyRow, OuraSleepUpsertRow, OuraTagRow, OuraDailySummaryRow, OuraDailyDerivedRow, OuraDailyDerivedPatch, WorkoutHrStatsInput, WorkoutHrStatsRow, SetHrStatsRow, DaytimeHrvModelRow } from '../../repository'
import type { SetHrRow, RichSetMarker } from '@trainingai/shared/workout/set-hr-stats'
import { aestMidnight, todayInTz, DEFAULT_TZ, shiftDateStr } from '@trainingai/shared/date-utils'
import { shouldPrune } from '../retention-throttle'
import { collapseOnConflict, keepLatestNonNull } from '../collapse-conflicts'
import { bodyCompSnapshot } from '@trainingai/shared/health/body-composition'
import { correctBodyFatPct, type BodyFatCalibration } from '@trainingai/shared/health/body-fat-calibration'
import { mergeSet, initialSourceMap, type HealthSource, type SourceColumn } from '@/lib/data/health-source'
import { resolveDsToMs, type ClockAnchor } from '@/lib/oura-ble/clock'

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

/**
 * Q-535 — a redecode run, tracked so the request does not have to wait for it.
 *
 * The route used to await the heaviest pair of calls in the app and exceed the gateway timeout, so
 * Railway returned 502 and the tester printed "redecode failed" for work that had completed
 * (measured: `scanned=1098158`, every `sleep_sessions` row stamped *after* the 502). A false failure
 * invites a retry, and a retry is another full-history pass of the operation whose own comment names
 * it as the event-loop starvation that took production down.
 *
 * One in-flight job per user, enforced by a partial unique index: the 4/min rate limit does not stop
 * two overlapping runs, and two concurrent full-history re-aggregates are exactly the load this
 * exists to prevent.
 */
export interface RedecodeJob {
  id: number
  startedAt: Date
  finishedAt: Date | null
  opts: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  /** LA-56: when the staleness reaper gave up. Non-null alongside a `result` means the run outran
   *  the window and finished anyway — the case that used to be discarded. */
  reapedAt: Date | null
}

const REDECODE_JOB_COLS = {
  id: s.ouraRedecodeJobs.id,
  startedAt: s.ouraRedecodeJobs.startedAt,
  finishedAt: s.ouraRedecodeJobs.finishedAt,
  opts: s.ouraRedecodeJobs.opts,
  result: s.ouraRedecodeJobs.result,
  error: s.ouraRedecodeJobs.error,
  reapedAt: s.ouraRedecodeJobs.reapedAt,
}

const asJob = (r: {
  id: number; startedAt: Date; finishedAt: Date | null; opts: unknown; result: unknown
  error: string | null; reapedAt: Date | null
}): RedecodeJob => ({
  id: r.id,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  opts: (r.opts as Record<string, unknown>) ?? {},
  result: (r.result as Record<string, unknown> | null) ?? null,
  error: r.error,
  reapedAt: r.reapedAt,
})

/** Returns the existing running job instead of starting a second — see the unique index. */
export async function startRedecodeJob(
  db: Db, userId: string, opts: Record<string, unknown>,
): Promise<{ job: RedecodeJob; alreadyRunning: boolean }> {
  const running = await getRunningRedecodeJob(db, userId)
  if (running) return { job: running, alreadyRunning: true }
  const [row] = await db
    .insert(s.ouraRedecodeJobs)
    .values({ userId, opts })
    .returning(REDECODE_JOB_COLS)
  return { job: asJob(row), alreadyRunning: false }
}

export async function getRunningRedecodeJob(db: Db, userId: string): Promise<RedecodeJob | null> {
  const [row] = await db
    .select(REDECODE_JOB_COLS)
    .from(s.ouraRedecodeJobs)
    .where(and(eq(s.ouraRedecodeJobs.userId, userId), isNull(s.ouraRedecodeJobs.finishedAt)))
    .limit(1)
  return row ? asJob(row) : null
}

/** User-scoped by id AND user: a job id is returned to a client, so it must not be readable across
 *  accounts just because it was guessed. */
export async function getRedecodeJob(db: Db, userId: string, id: number): Promise<RedecodeJob | null> {
  const [row] = await db
    .select(REDECODE_JOB_COLS)
    .from(s.ouraRedecodeJobs)
    .where(and(eq(s.ouraRedecodeJobs.userId, userId), eq(s.ouraRedecodeJobs.id, id)))
    .limit(1)
  return row ? asJob(row) : null
}

export async function getLatestRedecodeJob(db: Db, userId: string): Promise<RedecodeJob | null> {
  const [row] = await db
    .select(REDECODE_JOB_COLS)
    .from(s.ouraRedecodeJobs)
    .where(eq(s.ouraRedecodeJobs.userId, userId))
    .orderBy(desc(s.ouraRedecodeJobs.startedAt))
    .limit(1)
  return row ? asJob(row) : null
}

/**
 * Close a job with its outcome.
 *
 * **A REAPED ROW IS STILL CLOSED HERE (LA-56).** This used to filter `isNull(finishedAt)`, which the
 * reaper has already set — so a run that finished after being declared abandoned discarded its own
 * result, and the work landed while the record said it had failed. That is the one state worse than
 * either truth, and it is not hypothetical: every full-history redecode that has ever run was
 * reaped at the 30-minute window, so a late success has never had anywhere to go.
 *
 * `reapedAt` preserves what happened rather than papering over it: the row still carries the moment
 * the reaper gave up on it, so "this took longer than the staleness window" stays legible next to
 * the result that eventually arrived. A row that was never reaped keeps `reapedAt` null.
 *
 * A job that genuinely finished and recorded a result stays immutable: only an open row, or a
 * reaped row that never got an outcome, can be closed here.
 */
export async function finishRedecodeJob(
  db: Db, id: number, result: Record<string, unknown> | null, error: string | null,
): Promise<void> {
  await db
    .update(s.ouraRedecodeJobs)
    .set({ finishedAt: new Date(), result, error })
    .where(and(
      eq(s.ouraRedecodeJobs.id, id),
      // Open, or reaped-and-still-outcomeless. A job that genuinely finished and recorded a result
      // stays immutable — that guarantee predates this change and a duplicate callback must not
      // clobber a good result.
      or(isNull(s.ouraRedecodeJobs.finishedAt), and(
        isNotNull(s.ouraRedecodeJobs.reapedAt),
        isNull(s.ouraRedecodeJobs.result),
      )),
    ))
}

/**
 * A job whose process died mid-run would otherwise stay `running` forever — and, because of the
 * one-at-a-time index, would block every future redecode. Closed on read rather than by a sweeper:
 * there is no cron layer in this app, and the only reader that matters is the one asking whether it
 * may start another.
 */
export const REDECODE_JOB_STALE_MS = 30 * 60_000

export async function reapStaleRedecodeJobs(db: Db, userId: string, nowMs = Date.now()): Promise<number> {
  const rows = await db
    .update(s.ouraRedecodeJobs)
    .set({
      finishedAt: new Date(nowMs),
      reapedAt: new Date(nowMs),
      error: 'abandoned — no result recorded before the staleness window elapsed (the process most likely restarted mid-run)',
    })
    .where(and(
      eq(s.ouraRedecodeJobs.userId, userId),
      isNull(s.ouraRedecodeJobs.finishedAt),
      lt(s.ouraRedecodeJobs.startedAt, new Date(nowMs - REDECODE_JOB_STALE_MS)),
    ))
    .returning({ id: s.ouraRedecodeJobs.id })
  return rows.length
}

/**
 * Q-314 — the owner's declaration that the ring was deliberately re-keyed.
 *
 * A re-key restarts the ring's own clock, and the app cannot tell that apart from a history
 * re-drain by counter shape alone: both make a batch's max ds fall below the epoch's high-water
 * mark, and reading a re-drain as a reset re-timed the whole sleep history twice. A re-key is a
 * deliberate act done with `open_oura` on a laptop, so it is declared rather than guessed.
 *
 * At most one may be outstanding, enforced by a partial unique index — a second declaration cannot
 * mean anything the first does not, and two pending rows would open two epochs on two drains.
 */
export async function declareOuraRekey(db: Db, userId: string, note: string | null): Promise<{
  id: number; declaredAt: Date; alreadyPending: boolean
}> {
  const existing = await getPendingRekeyDeclaration(db, userId)
  // Idempotent rather than an error: pressing twice is the likeliest mistake, and the honest answer
  // is "one is already waiting", not a failure that invites a third press.
  if (existing) return { ...existing, alreadyPending: true }
  const [row] = await db
    .insert(s.ouraBleRekeyDeclarations)
    .values({ userId, note })
    .returning({ id: s.ouraBleRekeyDeclarations.id, declaredAt: s.ouraBleRekeyDeclarations.declaredAt })
  return { ...row, alreadyPending: false }
}

export async function getPendingRekeyDeclaration(db: Db, userId: string): Promise<{ id: number; declaredAt: Date } | null> {
  const [row] = await db
    .select({ id: s.ouraBleRekeyDeclarations.id, declaredAt: s.ouraBleRekeyDeclarations.declaredAt })
    .from(s.ouraBleRekeyDeclarations)
    .where(and(eq(s.ouraBleRekeyDeclarations.userId, userId), isNull(s.ouraBleRekeyDeclarations.consumedAt)))
    .limit(1)
  return row ?? null
}

/** Marked consumed only once the anchor for `epoch` is written — see the ingest path. */
export async function consumeRekeyDeclaration(db: Db, id: number, epoch: number): Promise<void> {
  await db
    .update(s.ouraBleRekeyDeclarations)
    .set({ consumedAt: new Date(), openedEpoch: epoch })
    .where(and(eq(s.ouraBleRekeyDeclarations.id, id), isNull(s.ouraBleRekeyDeclarations.consumedAt)))
}

/** Cancel a declaration made by mistake, before any drain has acted on it. Scoped to the user and
 *  to the un-consumed row, so it can never retract an epoch that already exists. */
export async function cancelPendingRekeyDeclaration(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .delete(s.ouraBleRekeyDeclarations)
    .where(and(eq(s.ouraBleRekeyDeclarations.userId, userId), isNull(s.ouraBleRekeyDeclarations.consumedAt)))
    .returning({ id: s.ouraBleRekeyDeclarations.id })
  return rows.length > 0
}

/**
 * Has the ring ever reported at all?
 *
 * Split out from `getLatestOuraBleMeasuredAt` in Q-541 Task 7, because `/api/oura/stats` was using
 * "we can name a last-measured time" as a proxy for "the ring is connected", and those stopped being
 * the same question once the time became derived: a user with frames but no resolvable clock anchor
 * has a ring, and would have silently lost the Health tab's entire Ring section
 * (`oura-section.tsx` returns null on `!connected`) with nothing failing anywhere.
 *
 * Existence is also the cheaper query — `EXISTS` stops at the first row where the old path took a
 * `max()` — and it covers both tiers, so a ring whose whole history has been packed still counts.
 */
export async function hasOuraBleSamples(db: Db, userId: string): Promise<boolean> {
  const [[hot], [packed]] = await Promise.all([
    db.select({ one: sql<number>`1` }).from(s.ouraRawSamples).where(eq(s.ouraRawSamples.userId, userId)).limit(1),
    db.select({ one: sql<number>`1` }).from(s.ouraRawPacked).where(eq(s.ouraRawPacked.userId, userId)).limit(1),
  ])
  return hot != null || packed != null
}

/**
 * When the ring last recorded anything, in wall clock.
 *
 * Q-541 Task 7 / Q-534: derived from `max(ring_timestamp_ds)` through the clock anchors, not read
 * from the stored `measured_at` column. This was the second and last reader of
 * `idx_oura_raw_samples_user_measured` — 136 MB, and the index that made a `measured_at` re-stamp
 * rewrite 681,005 rows with zero HOT updates and fill the disk.
 *
 * It is also the more correct answer twice over. The stored column is a derivation frozen at write
 * time, so it goes stale whenever the clock model changes — which it has, twice (Q-71, Q-536) — and
 * a packed frame does not carry the column at all, so a `max(measured_at)` would report the hot
 * window's edge as the ring's last activity.
 */
export async function getLatestOuraBleMeasuredAt(db: Db, userId: string): Promise<Date | null> {
  const [[hot], [packed], anchorRows] = await Promise.all([
    db
      .select({ maxDs: sql<number | null>`max(${s.ouraRawSamples.ringTimestampDs})::bigint` })
      .from(s.ouraRawSamples)
      .where(eq(s.ouraRawSamples.userId, userId)),
    db
      .select({ maxDs: sql<number | null>`max(${s.ouraRawPacked.maxDs})::bigint` })
      .from(s.ouraRawPacked)
      .where(eq(s.ouraRawPacked.userId, userId)),
    db
      .select({
        epoch: s.ouraBleClockAnchors.epoch,
        anchorDs: s.ouraBleClockAnchors.anchorDs,
        anchorUtc: s.ouraBleClockAnchors.anchorUtc,
      })
      .from(s.ouraBleClockAnchors)
      .where(eq(s.ouraBleClockAnchors.userId, userId))
      .orderBy(asc(s.ouraBleClockAnchors.anchorDs)),
  ])

  const candidates = [hot?.maxDs, packed?.maxDs]
    .map(v => (v == null ? null : Number(v)))
    .filter((v): v is number => v != null)
  if (candidates.length === 0) return null

  const anchors: ClockAnchor[] = anchorRows.map(r => ({
    epoch: r.epoch, anchorDs: Number(r.anchorDs), anchorUtcMs: new Date(r.anchorUtc).getTime(),
  }))
  const ms = resolveDsToMs(Math.max(...candidates), anchors)
  return ms != null ? new Date(ms) : null
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
  // Two re-segmentations of the same night reach here with one `sleep_start` — the conflict target
  // — and would reject the whole batch (21000). Every row shares `source`, so the rank arm reduces
  // to "newer non-null wins": `keepLatestNonNull` is that arm, applied before `initialSourceMap`
  // reads the merged values.
  const collapsed = collapseOnConflict(sessions, r => r.sleepStart.getTime(), keepLatestNonNull)
  await db
    .insert(s.sleepSessions)
    .values(collapsed.map(r => {
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

/**
 * How long the raw heart-rate series is kept. Two mesocycles of workout HR detail; derived
 * per-session stats live in `exercise_logs`/`set_logs` and are unaffected by pruning it.
 *
 * **Exported, and written once.** The number lived in two places — the prune's SQL literal below and
 * `ZONE_HR_RETENTION_DAYS` further down, which exists precisely *because* of the prune. A retention
 * window is a boundary tests place fixtures against, and an invisible one is a fixture that expires:
 * `batch-upsert-duplicate-collapse.test.ts` hardcoded a date that crossed this horizon on
 * 2026-08-29 and took `main` red, because the unawaited prune below deleted the rows it had just
 * written. That test now derives its fixtures from this constant.
 */
export const HR_RETENTION_DAYS = 180

// Throttled retention prune — fires at most once per 24h, fire-and-forget.
let lastHeartrateStorePrune = 0
const HR_PRUNE_THROTTLE_MS = 24 * 60 * 60 * 1000

export async function upsertOuraHeartrate(db: Db, userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]) {
  if (rows.length === 0) return
  // Collapse repeats on the conflict target BEFORE the insert — one duplicated timestamp otherwise
  // discards an entire 5,000-point CHUNK, which is what Q-214 was (see `collapse-conflicts.ts`).
  // Last value wins, matching this arm's bare excluded.* semantics.
  const values = collapseOnConflict(
    rows.map(r => ({ userId, timestamp: r.timestamp, bpm: r.bpm, source: r.source })),
    r => r.timestamp.getTime(),
  )
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
    db.execute(sql`DELETE FROM oura_heartrate WHERE timestamp < now() - (${HR_RETENTION_DAYS} || ' days')::interval`).catch(err => console.error('[prune] oura_heartrate failed:', err))
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
  // Same 21000 hazard as `upsertOuraHeartrate`, and worse per failure: a duplicated
  // (tier, bucket_start_ms) discards 2,000 buckets. Bare excluded.* arm → last wins.
  const values = collapseOnConflict(
    rows.map(r => ({ userId, ...r })),
    r => `${r.tier}\u0000${r.bucketStartMs}`,
  )
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
 *
 * **⚠ ITS INDEX IS GONE, AND THE DRIVER MUST RECREATE IT (BF-55, migration 249).** Point 3 above
 * said this "costs nothing at runtime" and that was true of the *method*; the index was never in
 * that accounting. `oura_heartrate_user_updated (user_id, updated_at, id)` measured **21 MB at
 * `idx_scan` 0** — a quarter of the whole database's index budget, plus write amplification on the
 * app's highest-volume insert — so it was dropped and the method kept.
 *
 * Without it these keyset queries fall back to a scan, which is fine at test size and is **not**
 * fine against 87 k+ production rows. Recreating it is one statement, and it belongs in the same
 * change as the driver rather than in a later "why is restore slow" investigation:
 *
 * ```sql
 * CREATE INDEX IF NOT EXISTS oura_heartrate_user_updated ON oura_heartrate(user_id, updated_at, id);
 * ```
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

// Days older than this can no longer be recomputed — the raw oura_heartrate series is pruned at the
// same horizon (`HR_RETENTION_DAYS`, upsertOuraHeartrate above), which is why this reads it rather
// than repeating the number. So a cached day past it keeps its frozen split even on a profile
// mismatch: it is the permanent record once HR thins (review H-4, Design §2).
const ZONE_HR_RETENTION_DAYS = HR_RETENTION_DAYS

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

/**
 * Average BPM for many sessions at once, as a `sessionId → avgBpm` map (Q-421).
 *
 * The energy path estimates a whole 14-day window in one pass, so the per-session
 * `getWorkoutHrStats` above would be N queries on a route that already runs a lot of them. Sessions
 * with no snapshot, or a snapshot whose `avg_bpm` is null, are simply absent from the map — the
 * caller falls back to the MET estimate for those, which is 36 of the owner's 78 sessions.
 */
export async function getAvgBpmBySession(db: Db, userId: string, sessionIds: string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map()
  const rows = await db
    .select({ id: s.workoutHrStats.workoutSessionId, avgBpm: s.workoutHrStats.avgBpm })
    .from(s.workoutHrStats)
    .where(and(
      eq(s.workoutHrStats.userId, userId),
      inArray(s.workoutHrStats.workoutSessionId, sessionIds),
    ))
  return new Map(rows.filter(r => r.avgBpm != null).map(r => [r.id, r.avgBpm as number]))
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
// Q-155. `userId` is REQUIRED, and it was not always: this took a session id and constrained
// ownership nowhere — no predicate, no join condition, no pre-check. It was safe only because its
// one caller happened to pass an id from a user-scoped query, which is a property of the caller and
// not of this function. Its siblings (`getSetHrStatsForSession`, `upsertSetHrStats`) already took
// `userId`, so this was the odd one out rather than a considered exemption.
//
// This is the class `scripts/check-repository-user-scoping.js` is structurally blind to — that check
// catches a method that TAKES `userId` and never uses it; nothing catches one that never asked.
export async function getSetDetailsForSession(db: Db, userId: string, workoutSessionId: string): Promise<RichSetMarker[]> {
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
      eq(s.workoutSessions.userId, userId),
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
  // Conflict target is `set_log_id`, so a batch naming one set twice rejects every set in the
  // workout (21000). The arm is COALESCE gated on `readings_count >=`, so the collapse mirrors it:
  // the fuller compute survives, later wins a tie. Plain last-wins would let a partial recompute
  // beat a fuller sibling — the exact clobber this function's setWhere exists to prevent.
  const collapsed = collapseOnConflict(rows, r => r.setLogId, (existing, incoming) =>
    incoming.readingsCount >= existing.readingsCount ? incoming : existing)
  await db.insert(s.setHrStats)
    .values(collapsed.map(r => ({
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

// Q-155. Same unscoped shape as `getSetDetailsForSession` above, and it needs the
// `workout_sessions` join added rather than just a predicate — the owner is not reachable from
// `set_logs`/`exercise_logs` alone, which is exactly why the scope was easy to omit.
export async function getSetTimestampsForSession(db: Db, userId: string, workoutSessionId: string) {
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
    .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
    .where(and(
      eq(s.exerciseLogs.workoutSessionId, workoutSessionId),
      eq(s.workoutSessions.userId, userId),
      isNull(s.setLogs.deletedAt),
      isNull(s.exerciseLogs.deletedAt),
    ))
    .orderBy(asc(s.setLogs.updatedAt))
  return rows.map(r => ({
    exerciseName: r.exerciseName,
    setNumber:    r.setNumber,
    setStartMs:   r.setStartMs,
    setEndMs:     r.setEndMs,
    loggedAt:     r.setEndMs != null ? new Date(r.setEndMs) : r.updatedAt,
  }))
}

// Q-155. An unscoped UPDATE — the highest-severity of the three, because a read leaks and a write
// changes someone else's row. It has no production caller today, which is precisely why it could sit
// like this: nothing exercised it, so nothing was wrong yet.
export async function markHrSynced(db: Db, userId: string, workoutSessionId: string) {
  await db
    .update(s.workoutSessions)
    .set({ hrSyncedAt: new Date() })
    .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId)))
}

// No production caller today — only the adapter wrapper, the repository interface and a test. Kept
// rather than deleted because that test is real soft-delete coverage; fixed rather than left wrong
// because a window keyed to the owner's zone is what an eventual caller would inherit (LA-19).
export async function getUnsyncedHrSessionsForDay(db: Db, userId: string, day: string, timezone = DEFAULT_TZ) {
  const [y, m, d] = day.split('-').map(Number)
  const from = aestMidnight(y, m, d, timezone)
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
 *  older rows it deliberately didn't recompute.
 *
 *  Shaped like `replaceDaytimeStressBuckets` below, and for its reasons (Q-528). Three ways this
 *  used to lose a history it had no business touching, all reproduced against Postgres before they
 *  were fixed:
 *
 *  1. **The guard sat below the delete.** A full-history pass that assembled no nights — a narrow
 *     window, a decode that produced nothing — deleted every row and returned successfully. No
 *     error, no log. Returning before the delete is what makes "computed nothing" mean "change
 *     nothing" instead of "erase everything". **The trade, stated:** a user whose history genuinely
 *     should end up empty now keeps their stale rows, because this function can no longer tell that
 *     apart from a pass that failed to compute. Deliberately clearing a history is a separate act
 *     and wants its own path; inferring it from an empty argument is what made the wipe silent.
 *  2. **The delete and the insert were separate statements.** A rejected insert left the delete
 *     committed and the user with an empty table, so a bad row cost the whole history rather than
 *     itself. They share a transaction now, which also means a concurrent reader never sees the
 *     empty window between them.
 *  3. **The insert had no conflict arm** against the `(user_id, date)` UNIQUE, so one repeated day
 *     raised 23505 and rejected every row in the statement — Q-280's shape under a different
 *     SQLSTATE. Duplicates are collapsed last-wins, matching what a replace means. */
export async function replaceOuraDailySummary(db: Db, userId: string, rows: OuraDailySummaryRow[]): Promise<void> {
  // Before the delete, not after it: a pass that computed nothing must not erase what is stored.
  if (rows.length === 0) return
  const values = collapseOnConflict(rows.map(r => summaryRowValues(userId, r)), r => r.date)
  await db.transaction(async tx => {
    await tx.delete(s.ouraDailySummary).where(eq(s.ouraDailySummary.userId, userId))
    await tx.insert(s.ouraDailySummary).values(values)
  })
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
  trainingLoadOts: 'training_load_ots', trainingLoadHigh: 'training_load_high', trainingLoadGate: 'training_load_gate',
  recoveryIndexHours: 'recovery_index_hours', wornHoursBle: 'worn_hours_ble', nightHrvBaselineMs: 'night_hrv_baseline_ms',
  illnessFlag: 'illness_flag', illnessScore: 'illness_score', illnessBiomarkers: 'illness_biomarkers',
  daytimeStressScaled: 'daytime_stress_scaled', stressHighMinutes: 'stress_high_minutes', recoveryHighMinutes: 'recovery_high_minutes',
  chronicStressScore: 'chronic_stress_score', chronicStressContributors: 'chronic_stress_contributors', resilienceLevel: 'resilience_level',
  resilienceDailyStress: 'resilience_daily_stress', resilienceDailyRestorativeTime: 'resilience_daily_restorative_time',
  resilienceDailySleepRecovery: 'resilience_daily_sleep_recovery', resilienceGranular: 'resilience_granular', resilienceConfidence: 'resilience_confidence',
  daytimeStressCoverageMin: 'daytime_stress_coverage_min', chronicStressGranularNights: 'chronic_stress_granular_nights',
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
    // `model_versions` is a MAP of pillar → version, and COALESCE-replace is wrong for a map: a
    // writer stamping its own key replaces every other pillar's. That was live — `backfillBodyComp`
    // wrote `{bodyComp: …}` flat, erasing the readiness stamp on every day it touched, and readiness
    // survived only because it read the row first and spread the result back (two statements, so a
    // race, and it reads a value that may already be stale). Merging with `||` inside the same
    // statement makes a stamp additive by construction: each pillar writes only its own key, no
    // writer can clobber another, and no caller needs a read-merge. Q-273.
    set[k] = k === 'modelVersions'
      ? sql.raw(`COALESCE(oura_daily_derived.${col}, '{}'::jsonb) || COALESCE(excluded.${col}, '{}'::jsonb)`)
      : sql.raw(`COALESCE(excluded.${col}, oura_daily_derived.${col})`)
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
    trainingLoadGate: r.trainingLoadGate,
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
    daytimeStressCoverageMin: r.daytimeStressCoverageMin,
    chronicStressGranularNights: r.chronicStressGranularNights,
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

// DB-footprint readout for the admin console (Sub-plan G-2 / culling): per-table row counts + total
// bytes for the Oura tables, plus the `oura_raw_samples` decoded-vs-body_hex split so the owner can
// SEE what the culling levers reclaim (decoded is re-derivable; body_hex is archival). Read-only,
// admin-gated.
//
// **The row counts are COUNTED, not estimated (BF-54).** This read used `n_live_tup`, which CLAUDE.md
// already documents as a planner estimate maintained by autovacuum — and `last_analyze` is NULL on
// every table in this database, so it can be arbitrarily stale. Measured against production on
// 2026-08-30 it was not marginally wrong: `oura_raw_samples` read **552** against **180,415** real
// rows, `rr_intervals` **0** against 87,015, `error_events` **1** against 6,102. The owner's screen
// said 297 rows directly below a line reading "0 / 180,160", three orders of magnitude apart.
//
// The sizes stay from `pg_total_relation_size`, which is read from the filesystem and is exact — it
// is only the ROW columns of `pg_stat_user_tables` that are estimates. Counting 14 tables is a seq
// scan of tens of MB on a screen pressed occasionally, and the raw-sample split below already does a
// far more expensive full scan with `pg_column_size` on the largest table of the set.
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
    SELECT relname AS table, pg_total_relation_size(relid) AS bytes
    FROM pg_stat_user_tables
    WHERE relname IN (${tableList})
    ORDER BY pg_total_relation_size(relid) DESC
  `)).rows as { table: string; bytes: string | number }[]

  // The names come from the module constant above, never from a request — but they are interpolated
  // as identifiers, so they are checked here too rather than trusted, the same belt-and-braces the
  // VACUUM allowlist below applies for the same reason.
  const bad = OURA_FOOTPRINT_TABLES.find(t => !/^[a-z_][a-z0-9_]*$/.test(t))
  if (bad) throw new Error(`getOuraStorageStats: ${bad} is not a plain identifier`)
  const countRows = (await db.execute(sql.raw(
    OURA_FOOTPRINT_TABLES.map(t => `SELECT '${t}' AS table, count(*)::bigint AS rows FROM ${t}`).join(' UNION ALL '),
  ))).rows as { table: string; rows: string | number }[]
  const countByTable = new Map(countRows.map(r => [r.table, Number(r.rows)]))

  const rawRow = ((await db.execute(sql`
    SELECT count(*)::bigint AS total_rows,
           count(*) FILTER (WHERE decoded IS NOT NULL)::bigint AS decoded_rows,
           COALESCE(sum(pg_column_size(decoded)), 0)::bigint AS decoded_bytes,
           COALESCE(sum(pg_column_size(body_hex)), 0)::bigint AS body_hex_bytes
    FROM oura_raw_samples
  `)).rows[0] ?? {}) as Record<string, string | number>

  return {
    // A table absent from `pg_stat_user_tables` cannot reach here (the size query is what produces
    // this list), so every row has a count.
    tables: sizeRows.map(r => ({ table: r.table, rows: countByTable.get(r.table) ?? 0, bytes: Number(r.bytes) })),
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
/**
 * Tables this may rewrite, and why each is here.
 *
 * An allowlist rather than a validated identifier, because `VACUUM FULL` cannot take a bind
 * parameter — the table name is interpolated into the statement, so the only safe input is one that
 * never came from a request. A caller naming anything else is rejected.
 *
 * It is also a judgement list, not just a safety one: `VACUUM FULL` takes an ACCESS EXCLUSIVE lock
 * and needs free disk equal to the table's current size, so it belongs on tables where a deliberate,
 * owner-pressed rewrite is the right tool.
 */
export const VACUUM_FULL_TABLES = {
  // The original Lever 1c target. Nulling `decoded` frees space only logically — MVCC leaves dead
  // tuples that autovacuum reuses internally but never returns to the OS. Also what reclaims the
  // space after Q-541's packing backfill deletes the hot rows.
  oura_raw_samples: 'raw BLE frames',
  // Q-315. 4 live rows in 49 MB (measured 2026-08-18) — 6% of the whole database, held by dead
  // tuples and TOAST left behind after Q-539 fixed the write path and the rows were pruned. One
  // fault had written 5,771 rows because the dedupe key varied with a generated VALUES list, each
  // message truncated to exactly 2,000 chars of boilerplate. Nothing re-grows: this is a one-off
  // reclaim, not a recurring chore.
  error_events: 'server error log',
} as const

export type VacuumFullTable = keyof typeof VACUUM_FULL_TABLES

export async function vacuumTableFull(table: VacuumFullTable): Promise<{
  table: string; liveRows: number; beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number
}> {
  // Belt and braces over the type: this value is interpolated into SQL, so it is checked against the
  // allowlist at runtime too rather than trusting a compile-time union a caller can cast past.
  if (!Object.prototype.hasOwnProperty.call(VACUUM_FULL_TABLES, table)) {
    throw new Error(`vacuumTableFull: ${table} is not in the allowlist`)
  }
  const pool = getPool()
  const client = await pool.connect()
  const sizeOf = async () =>
    Number((await client.query(`SELECT pg_total_relation_size($1)::bigint AS bytes`, [table])).rows[0]?.bytes ?? 0)
  try {
    const beforeBytes = await sizeOf()
    // Reported so the reclaim can be read honestly. A huge `before` against a handful of live rows
    // is the signature of pure bloat — which is exactly Q-315's case, and is a different situation
    // from a large table that is genuinely large.
    //
    // **Counted, not estimated (BF-54).** That reasoning is only sound on a real number, and this
    // read `n_live_tup`: against `oura_raw_samples` on 2026-08-30 it said 552 rows in 67 MB, i.e.
    // *pure bloat*, on a table holding **180,415** rows. Acting on that verdict takes an ACCESS
    // EXCLUSIVE lock with the timeouts deliberately lifted, and reclaims nothing. The count is a seq
    // scan, which is trivial beside the VACUUM FULL it is about to justify.
    const liveRows = Number((await client.query(
      `SELECT count(*)::bigint AS rows FROM ${table}`)).rows[0]?.rows ?? 0)
    // VACUUM FULL can outlast the pool's 15s statement_timeout on a large table; lift both timeouts
    // for this session only, then destroy the connection (release(true)) so the pool never hands a
    // timeout-disabled client to normal query traffic.
    await client.query('SET statement_timeout = 0')
    await client.query('SET idle_in_transaction_session_timeout = 0')
    const started = Date.now()
    await client.query(`VACUUM (FULL) ${table}`)
    const ms = Date.now() - started
    const afterBytes = await sizeOf()
    return { table, liveRows, beforeBytes, afterBytes, reclaimedBytes: Math.max(0, beforeBytes - afterBytes), ms }
  } finally {
    client.release(true)
  }
}

/** The original single-table entry point, kept so the existing admin button and its route are
 *  untouched by the generalisation. */
export async function vacuumOuraRawSamples(): Promise<{
  beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number
}> {
  const { beforeBytes, afterBytes, reclaimedBytes, ms } = await vacuumTableFull('oura_raw_samples')
  return { beforeBytes, afterBytes, reclaimedBytes, ms }
}

export async function persistBodyCompFromMetrics(
  db: Db,
  userId: string,
  // Required, not defaulted: a default here would be a silent no-op — the backfill would run,
  // report a write count, and quietly persist uncorrected snapshots. Both callers must decide.
  bodyFatCalibration: BodyFatCalibration | null,
): Promise<number> {
  const rows = await db
    .select({
      date: s.bodyMetrics.date,
      weightKg: s.bodyMetrics.weightKg,
      bodyFatPct: s.bodyMetrics.bodyFatPct,
      sourceMap: s.bodyMetrics.sourceMap,
    })
    .from(s.bodyMetrics)
    .where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg), isNotNull(s.bodyMetrics.bodyFatPct)))
  let written = 0
  for (const r of rows) {
    // BF-2: per row, not per user — the calibration belongs to one instrument, and this backfill
    // walks the whole history, most of which was written by an instrument it does not cover.
    const corrected = correctBodyFatPct(r.bodyFatPct, r.sourceMap?.body_fat_pct ?? null, bodyFatCalibration)
    const snap = bodyCompSnapshot(r.weightKg, corrected?.pct ?? r.bodyFatPct)
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

// ── TN-3a: the 30-minute daytime-stress buckets ────────────────────────────────────────────────

export interface StressBucketRow {
  bucketStart: Date
  level: number
}

/**
 * Replace one local day's stress buckets.
 *
 * A whole-day REPLACE rather than a merge, deliberately: the series is recomputed as a unit from
 * that day's frames, so a re-run with fewer buckets (a shorter waking window, a frame that failed
 * to decode) must SHRINK the stored day rather than leave orphans from the previous pass merged in
 * beside the new ones. The delete and the insert share a transaction so a day is never briefly
 * empty for a concurrent reader.
 *
 * Scoped to `user_id` on both statements — the rollup runs per user and a day string is not a
 * user-scoped key on its own.
 */
export async function replaceDaytimeStressBuckets(
  db: Db, userId: string, day: string, buckets: StressBucketRow[],
): Promise<void> {
  await db.transaction(async tx => {
    await tx.delete(s.ouraDaytimeStressBuckets).where(
      and(eq(s.ouraDaytimeStressBuckets.userId, userId), eq(s.ouraDaytimeStressBuckets.day, day)),
    )
    if (buckets.length === 0) return
    // One repeated bucket instant would reject the whole day's insert (21000). Bare excluded.* arm.
    await tx.insert(s.ouraDaytimeStressBuckets).values(
      collapseOnConflict(
        buckets.map(b => ({ userId, day, bucketStart: b.bucketStart, level: b.level, updatedAt: new Date() })),
        b => b.bucketStart.getTime(),
      ),
    ).onConflictDoUpdate({
      target: [s.ouraDaytimeStressBuckets.userId, s.ouraDaytimeStressBuckets.bucketStart],
      set: { level: sql`excluded.level`, day: sql`excluded.day`, updatedAt: new Date() },
      // The conflict arm exists because a bucket INSTANT can land in a different local day than
      // the pass that wrote it last (a timezone change, or a wake window shifting across midnight):
      // the delete above only cleared THIS day, so the row may still be present under its old
      // `day`. Updating `day` is what re-files it.
      //
      // `setWhere` is scoped to the user per CLAUDE.md's standing rule for `onConflictDoUpdate`
      // arms. **It is redundant here, and that is recorded rather than left to look load-bearing**
      // — the primary key is `(user_id, bucket_start)`, so one user's insert cannot conflict with
      // another user's row. Verified by deleting this line and re-running the suite: nothing
      // changed. It stays as cheap insurance against the key ever narrowing.
      setWhere: eq(s.ouraDaytimeStressBuckets.userId, userId),
    })
  })
}

/** One user's buckets over an inclusive local-day range, oldest first. */
export async function listDaytimeStressBuckets(
  db: Db, userId: string, from: string, to: string,
): Promise<{ day: string; bucketStart: Date; level: number }[]> {
  const rows = await db
    .select({
      day: s.ouraDaytimeStressBuckets.day,
      bucketStart: s.ouraDaytimeStressBuckets.bucketStart,
      level: s.ouraDaytimeStressBuckets.level,
    })
    .from(s.ouraDaytimeStressBuckets)
    .where(and(
      eq(s.ouraDaytimeStressBuckets.userId, userId),
      gte(s.ouraDaytimeStressBuckets.day, from),
      lte(s.ouraDaytimeStressBuckets.day, to),
    ))
    .orderBy(asc(s.ouraDaytimeStressBuckets.bucketStart))
  return rows.map(r => ({ day: r.day, bucketStart: r.bucketStart, level: Number(r.level) }))
}
