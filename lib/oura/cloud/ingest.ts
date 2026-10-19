// Writes Oura Cloud documents into our tables (#2859), every one as source `oura_cloud`.
//
// Each table's own upsert decides what lands, so the ladder in `source-rank.ts` holds unchanged:
//   - `oura_daily` and `body_metrics` merge per field. The ring's BLE values (`oura_ble`) and a manual
//     entry outrank `oura_cloud`, so a Cloud value fills a field only where nothing better is stored,
//     except from the day the user switched to the Oura API: there a ring value is a partial left
//     from the switch, and Oura's replaces it (`mergeSet`, #2985). A re-import rewrites such a day.
//   - `sleep_sessions` and `oura_heartrate` are keyed by instant, not by day, so a Cloud period or
//     point that a ring, strap or manual row already covers is skipped instead of duplicated.
//   - `oura_workouts` holds only Oura's workouts, keyed by Oura's id.
//   - `oura_cloud_sleep_periods`, `oura_cloud_daily` and `oura_sessions` (#2982) hold only Oura's
//     values, read by no screen, so each write replaces what Oura sent before.
// Every upsert is idempotent: the same documents written twice leave the same rows.
//
// The BLE raw archive (`oura_raw_samples`, `oura_raw_packed`) is never touched here.
import type { WorkoutRepository } from '@/lib/data/repository'
import { withNightRescore, type NightRescoreRepo } from '@/lib/health/rescore-nights'
import type { OuraCloudWrites } from './documents'

/** The slice of the repository the writer needs, so tests can hand it a fake. */
export type OuraCloudWriter = Pick<WorkoutRepository,
  'upsertOuraDaily' | 'upsertBodyMetrics' | 'upsertOuraCloudSleep' | 'tombstoneOuraCloudSleep' |
  'upsertOuraWorkouts' | 'upsertOuraCloudHeartrate' |
  'upsertOuraCloudSleepPeriods' | 'upsertOuraCloudDaily' | 'upsertOuraSessions'>

export interface OuraCloudWriteCounts {
  dailyRows: number
  bodyRows: number
  sleepWritten: number
  sleepSkippedOverlap: number
  sleepTombstoned: number
  workouts: number
  heartRatePoints: number
  sleepPeriods: number
  cloudDays: number
  sessions: number
}

export const NO_WRITES: OuraCloudWriteCounts = {
  dailyRows: 0, bodyRows: 0, sleepWritten: 0, sleepSkippedOverlap: 0, sleepTombstoned: 0, workouts: 0, heartRatePoints: 0,
  sleepPeriods: 0, cloudDays: 0, sessions: 0,
}

/** What `writeOuraCloudData` would write, without writing: the dry run's numbers. */
export function plannedCounts(writes: OuraCloudWrites): OuraCloudWriteCounts {
  return {
    dailyRows: writes.daily.length,
    bodyRows: writes.body.length,
    sleepWritten: writes.sleep.length,
    sleepSkippedOverlap: 0,
    sleepTombstoned: writes.deletedSleepIds.length,
    workouts: writes.workouts.length,
    heartRatePoints: 0,
    sleepPeriods: writes.sleepPeriods.length,
    cloudDays: writes.cloudDaily.length,
    sessions: writes.sessions.length,
  }
}

/**
 * Writes one batch of mapped documents. The heart-rate series goes through `upsertOuraCloudHeartrate` directly.
 *
 * `rescore` (#3079): with it, a sleep write that changes, adds or removes a recent night re-scores
 * that night's day (`rescore-nights.ts`). Production passes the repository; tests that only count
 * writes leave it out.
 */
export async function writeOuraCloudData(
  writer: OuraCloudWriter, userId: string, writes: OuraCloudWrites, rescore?: NightRescoreRepo,
): Promise<OuraCloudWriteCounts> {
  await writer.upsertOuraDaily(userId, writes.daily, 'oura_cloud')
  await writer.upsertBodyMetrics(userId, writes.body, 'oura_cloud')
  const touchesSleep = writes.sleep.length > 0 || writes.deletedSleepIds.length > 0
  const { sleep, sleepTombstoned } = await withNightRescore(touchesSleep ? rescore : undefined, userId, async () => ({
    sleep: writes.sleep.length > 0 ? await writer.upsertOuraCloudSleep(userId, writes.sleep) : { written: 0, skippedOverlap: 0 },
    sleepTombstoned: await writer.tombstoneOuraCloudSleep(userId, writes.deletedSleepIds),
  }))
  const workouts = await writer.upsertOuraWorkouts(userId, writes.workouts)
  const sleepPeriods = await writer.upsertOuraCloudSleepPeriods(userId, writes.sleepPeriods)
  const cloudDays = await writer.upsertOuraCloudDaily(userId, writes.cloudDaily)
  const sessions = await writer.upsertOuraSessions(userId, writes.sessions)
  return {
    dailyRows: writes.daily.length,
    bodyRows: writes.body.length,
    sleepWritten: sleep.written,
    sleepSkippedOverlap: sleep.skippedOverlap,
    sleepTombstoned,
    workouts,
    heartRatePoints: 0,
    sleepPeriods,
    cloudDays,
    sessions,
  }
}
