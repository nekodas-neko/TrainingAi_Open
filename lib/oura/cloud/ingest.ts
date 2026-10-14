// Writes Oura Cloud documents into our tables (#2859), every one as source `oura_cloud`.
//
// Each table's own upsert decides what lands, so the ladder in `source-rank.ts` holds unchanged:
//   - `oura_daily` and `body_metrics` merge per field. The ring's BLE values (`oura_ble`) and a manual
//     entry outrank `oura_cloud`, so a Cloud value fills a field only where nothing better is stored.
//   - `sleep_sessions` and `oura_heartrate` are keyed by instant, not by day, so a Cloud period or
//     point that a ring, strap or manual row already covers is skipped instead of duplicated.
//   - `oura_workouts` holds only Oura's workouts, keyed by Oura's id.
// Every upsert is idempotent: the same documents written twice leave the same rows.
//
// The BLE raw archive (`oura_raw_samples`, `oura_raw_packed`) is never touched here.
import type { WorkoutRepository } from '@/lib/data/repository'
import type { OuraCloudWrites } from './documents'

/** The slice of the repository the writer needs, so tests can hand it a fake. */
export type OuraCloudWriter = Pick<WorkoutRepository,
  'upsertOuraDaily' | 'upsertBodyMetrics' | 'upsertOuraCloudSleep' | 'tombstoneOuraCloudSleep' |
  'upsertOuraWorkouts' | 'upsertOuraCloudHeartrate'>

export interface OuraCloudWriteCounts {
  dailyRows: number
  bodyRows: number
  sleepWritten: number
  sleepSkippedOverlap: number
  sleepTombstoned: number
  workouts: number
  heartRatePoints: number
}

export const NO_WRITES: OuraCloudWriteCounts = {
  dailyRows: 0, bodyRows: 0, sleepWritten: 0, sleepSkippedOverlap: 0, sleepTombstoned: 0, workouts: 0, heartRatePoints: 0,
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
  }
}

/** Writes one batch of mapped documents. The heart-rate series goes through `upsertOuraCloudHeartrate` directly. */
export async function writeOuraCloudData(writer: OuraCloudWriter, userId: string, writes: OuraCloudWrites): Promise<OuraCloudWriteCounts> {
  await writer.upsertOuraDaily(userId, writes.daily, 'oura_cloud')
  await writer.upsertBodyMetrics(userId, writes.body, 'oura_cloud')
  const sleep = writes.sleep.length > 0 ? await writer.upsertOuraCloudSleep(userId, writes.sleep) : { written: 0, skippedOverlap: 0 }
  const sleepTombstoned = await writer.tombstoneOuraCloudSleep(userId, writes.deletedSleepIds)
  const workouts = await writer.upsertOuraWorkouts(userId, writes.workouts)
  return {
    dailyRows: writes.daily.length,
    bodyRows: writes.body.length,
    sleepWritten: sleep.written,
    sleepSkippedOverlap: sleep.skippedOverlap,
    sleepTombstoned,
    workouts,
    heartRatePoints: 0,
  }
}
