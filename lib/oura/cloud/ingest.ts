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
//     values, so each write replaces what Oura sent before. Three columns are read now (#3081):
//     a period's `sleep_type` decides which periods make a night (#3057), and a day's
//     `readiness_contributors` (#2984) and `met` with its `class_5_min` wear gate (#2985) are inputs.
//     The rest is still storage no screen reads.
// Every upsert is idempotent: the same documents written twice leave the same rows.
//
// The BLE raw archive (`oura_raw_samples`, `oura_raw_packed`) is never touched here.
import type { OuraCloudHeartrateWrite, WorkoutRepository } from '@/lib/data/repository'
import { withNightRescore, type NightRescoreRepo } from '@/lib/health/rescore-nights'
import type { OuraCloudWrites } from './documents'
import { reportOuraCloudIssue } from './report'
import { stillRhrDaysBetween, stillRhrDaysForDocuments, type StillRhrRefresh } from './still-rhr'

/**
 * Re-attributes the completed workouts a heart-rate write overlaps (#3078,
 * `reattributeWorkoutsHrInWindow`). Every writer of Oura Cloud heart rate takes one, so a workout
 * whose series landed after it was completed is refreshed whichever path brought the series.
 */
export type OuraWorkoutHrReattribute = (userId: string, from: Date, to: Date, tz: string) => Promise<number>

/**
 * After a heart-rate write: re-attributes the workouts over the span of the points that actually
 * changed, never over a re-read that changed nothing. A failure is reported under `kind` and never
 * fails the write it follows.
 */
export async function reattributeAfterHeartRate(
  workoutHr: OuraWorkoutHrReattribute | undefined, userId: string, write: OuraCloudHeartrateWrite, tz: string, kind: string,
): Promise<void> {
  if (!workoutHr || write.changed === 0 || !write.changedFrom || !write.changedTo) return
  try {
    await workoutHr(userId, write.changedFrom, write.changedTo, tz)
  } catch (err) {
    reportOuraCloudIssue(kind, err instanceof Error ? err.message : 'unknown', { userId })
  }
}

/**
 * After a heart-rate write: refreshes the still-period resting HR of the completed days the changed
 * points fall on (#2634). Never throws, and does nothing for a re-read that changed nothing.
 */
export async function refreshStillRhrAfterHeartRate(
  stillRhr: StillRhrRefresh | undefined, userId: string, write: OuraCloudHeartrateWrite, tz: string,
): Promise<void> {
  if (!stillRhr || write.changed === 0 || !write.changedFrom || !write.changedTo) return
  await stillRhr(userId, stillRhrDaysBetween(write.changedFrom, write.changedTo, tz))
}

/** The slice of the repository the writer needs, so tests can hand it a fake. */
export type OuraCloudWriter = Pick<WorkoutRepository,
  'upsertOuraDaily' | 'upsertBodyMetrics' | 'upsertOuraCloudSleep' | 'tombstoneOuraCloudSleep' | 'syncOuraMainSleepBodyMetrics' |
  'upsertOuraWorkouts' | 'tombstoneOuraWorkouts' | 'tombstoneOuraWorkoutsAbsent' | 'upsertOuraCloudHeartrate' |
  'upsertOuraCloudSleepPeriods' | 'upsertOuraCloudDaily' | 'upsertOuraSessions' | 'tombstoneOuraSessions' | 'tombstoneOuraSessionsAbsent'>

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
    sleepTombstoned: writes.deletedSleepIds.length + writes.retypedSleepIds.length,
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
 * `stillRhr` (#2634): with it, a batch carrying a day's MET series refreshes that day's still-period
 * resting HR once the rows are in.
 * `rescore` (#3079): with it, a sleep write that changes, adds or removes a recent night re-scores
 * that night's day (`rescore-nights.ts`). Production passes the repository; tests that only count
 * writes leave it out.
 */
export async function writeOuraCloudData(
  writer: OuraCloudWriter, userId: string, writes: OuraCloudWrites, rescore?: NightRescoreRepo, stillRhr?: StillRhrRefresh,
): Promise<OuraCloudWriteCounts> {
  await writer.upsertOuraDaily(userId, writes.daily, 'oura_cloud')
  await writer.upsertBodyMetrics(userId, writes.body, 'oura_cloud')
  // The period rows go first and inside the re-score window: `listSleepSessions` reads each
  // period's type from them, and the type decides which periods make the night (#3061). Written
  // after the sleep rows, a new night was scored before its types existed, so a short `sleep`
  // fragment beside the `long_sleep` joined it; and a write that only retyped a period was never
  // seen at all. The tombstone still runs after, so it has the last word on a deleted period.
  // #3080: a `rest` retype is tombstoned like a delete, and the day's HRV and resting HR are set from
  // its main period once every period is in. All of it inside the window, so the re-score sees it.
  const touchesSleep = writes.sleep.length > 0 || writes.deletedSleepIds.length > 0 ||
    writes.retypedSleepIds.length > 0 || writes.sleepPeriods.length > 0
  const { sleep, sleepTombstoned, sleepPeriods } = await withNightRescore(touchesSleep ? rescore : undefined, userId, async () => {
    const sleepPeriods = await writer.upsertOuraCloudSleepPeriods(userId, writes.sleepPeriods)
    const sleep = writes.sleep.length > 0 ? await writer.upsertOuraCloudSleep(userId, writes.sleep) : { written: 0, skippedOverlap: 0 }
    const sleepTombstoned = await writer.tombstoneOuraCloudSleep(userId, writes.deletedSleepIds) +
      (writes.retypedSleepIds.length > 0 ? await writer.tombstoneOuraCloudSleep(userId, writes.retypedSleepIds, { keepPeriodType: true }) : 0)
    if (touchesSleep) {
      await writer.syncOuraMainSleepBodyMetrics(userId, {
        days: [...writes.sleep.map(r => r.date), ...writes.sleepPeriods.map(p => p.day)],
        ouraIds: [...writes.deletedSleepIds, ...writes.retypedSleepIds],
      })
    }
    return { sleep, sleepTombstoned, sleepPeriods }
  })
  // #3080: a period a higher-ranked night keeps out is reported, counts only, never silent.
  if (sleep.skippedOverlap > 0) {
    reportOuraCloudIssue('sleep:skipped-overlap', `${sleep.skippedOverlap} Oura sleep period(s) kept out by a higher-ranked night`, { userId })
  }
  // #3081: a value Oura added to an enum keeps its document, and is said out loud. Field names and
  // counts only: the value is in `oura_cloud_sleep_periods.sleep_type` for a sleep type, and the
  // pinned spec is where a new one is added.
  const unknown = Object.entries(writes.unknownValues ?? {}).filter(([, n]) => (n ?? 0) > 0)
  if (unknown.length > 0) {
    reportOuraCloudIssue('document:unknown-value',
      `values outside the pinned spec, documents kept: ${unknown.map(([field, n]) => `${field} ×${n}`).join(', ')}`, { userId })
  }
  const workouts = await writer.upsertOuraWorkouts(userId, writes.workouts)
  const cloudDays = await writer.upsertOuraCloudDaily(userId, writes.cloudDaily)
  const sessions = await writer.upsertOuraSessions(userId, writes.sessions)
  // #2634: a day's activity document is what makes its still-period resting HR computable.
  if (stillRhr) await stillRhr(userId, stillRhrDaysForDocuments(writes.cloudDaily))
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
