import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import * as s from './schema'
import * as oura from './slices/oura'
import { readRawFrames } from './slices/oura-raw-frames'
import type { getDb } from './client'
import type { ClockAnchor } from '@/lib/oura-ble/clock'
import type { HealthSource } from '@/lib/data/health-source'
import type { BodyMetrics } from '@trainingai/shared/types'
import type { RollupIO, RollupFrameQuery } from '@/lib/oura-ble/rollup/io'

type Db = ReturnType<typeof getDb>

/**
 * The handful of repository operations the rollup needs that are not plain slice calls — the
 * ranked per-field body-metrics merge, the daytime-HRV refit, and the clock-anchor reads. Passed
 * in bound rather than re-implemented here, so there is still one implementation of each.
 */
export interface PostgresRollupIODeps {
  db: Db
  userId: string
  getOuraClockAnchor(userId: string): Promise<{ anchorDs: number; anchorUtc: Date } | null>
  getOuraClockAnchors(userId: string): Promise<ClockAnchor[]>
  upsertBodyMetrics(userId: string, rows: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[], source: HealthSource): Promise<void>
  refitDaytimeHrvModel(userId: string, timezone: string): Promise<void>
}

/** The server-side `RollupIO`: what `aggregateOuraRawSamples` did inline before D2 Task 2. */
export function createPostgresRollupIO(deps: PostgresRollupIODeps): RollupIO {
  const { db, userId } = deps
  return {
    readClockAnchor: () => deps.getOuraClockAnchor(userId),
    readClockAnchors: () => deps.getOuraClockAnchors(userId),

    readRollupWatermark: (currentEpoch: number) => oura.getOuraRollupWatermark(db, userId, currentEpoch),
    writeRollupWatermark: async (lastRolledDs, epoch) => { await oura.setOuraRollupWatermark(db, userId, lastRolledDs, epoch) },

    readRawFrames: (q: RollupFrameQuery) => readRawFrames(db, userId, q),

    deleteBleSleepSessionsForDates: async dates => {
      await db.delete(s.sleepSessions).where(and(
        eq(s.sleepSessions.userId, userId),
        sql`${s.sleepSessions.ouraId} LIKE 'ble:%'`,
        inArray(s.sleepSessions.date, dates),
      ))
    },
    upsertSleepSessions: rows => oura.upsertOuraSleep(db, userId, rows, 'oura_ble'),

    readStepLiveWindows: () => db
      .select({ startDs: s.stepLiveWindows.startDs, endDs: s.stepLiveWindows.endDs, steps: s.stepLiveWindows.steps })
      .from(s.stepLiveWindows)
      .where(eq(s.stepLiveWindows.userId, userId)),
    readExistingSteps: dates => db
      .select({ date: s.bodyMetrics.date, steps: s.bodyMetrics.steps, sourceMap: s.bodyMetrics.sourceMap })
      .from(s.bodyMetrics)
      .where(and(eq(s.bodyMetrics.userId, userId), inArray(s.bodyMetrics.date, dates))),
    upsertBodyMetrics: rows => deps.upsertBodyMetrics(userId, rows, 'oura_ble'),

    readWorkoutWindows: since => db
      .select({ startedAt: s.workoutSessions.startedAt, completedAt: s.workoutSessions.completedAt })
      .from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, since),
        isNull(s.workoutSessions.deletedAt),
      )),
    deleteBleHeartrateFrom: async since => {
      await db.delete(s.ouraHeartrate).where(and(
        eq(s.ouraHeartrate.userId, userId),
        eq(s.ouraHeartrate.source, 'ble'),
        gte(s.ouraHeartrate.timestamp, since),
      ))
    },
    upsertHeartrate: async rows => { await oura.upsertOuraHeartrate(db, userId, rows) },
    deleteZoneMinutesFrom: fromDay => oura.deleteZoneMinutesFrom(db, userId, fromDay),

    upsertOuraDaily: rows => oura.upsertOuraDaily(db, userId, rows, 'oura_ble'),
    readLatestDailySummaryBefore: date => oura.getLatestOuraDailySummaryBefore(db, userId, date),
    replaceDailySummary: rows => oura.replaceOuraDailySummary(db, userId, rows),
    upsertDailySummary: rows => oura.upsertOuraDailySummary(db, userId, rows),
    readDailyDerived: (from, to) => oura.getOuraDailyDerived(db, userId, from, to),
    upsertDailyDerived: (day, patch) => oura.upsertOuraDailyDerived(db, userId, day, patch),
    replaceStressBuckets: (day, buckets) => oura.replaceDaytimeStressBuckets(db, userId, day, buckets),

    readDaytimeHrvModel: () => oura.getDaytimeHrvModel(db, userId),
    refitDaytimeHrvModel: timezone => deps.refitDaytimeHrvModel(userId, timezone),
    persistBodyComp: async () => { await oura.persistBodyCompFromMetrics(db, userId) },
  }
}
