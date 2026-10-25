// #2634: the day's resting heart rate from still daytime periods, from Oura Cloud data.
//
// Heart rate is `oura_heartrate` rows of source `oura_cloud` (about one reading every 5 minutes), MET
// is the day's `daily_activity.met` series with its `class_5_min` wear gate (`ouraCloudMetGrid`, the
// same grid the training-stress route reads, #2985), and sleep is the stored nights and naps. The
// maths is `stillDaytimeRhr`, shared and source-agnostic; this only gathers its inputs and stores the
// result on `oura_daily_derived`.
//
// Run for each COMPLETED local day a write could have changed: when a day's activity document lands
// or is revised, and when heart rate for it lands. A day that falls short of the coverage floor writes
// nothing, so a thin day stays NULL and a thin re-read never replaces a fuller value.
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, toAestDay, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { ouraCloudMetGrid } from '@trainingai/shared/health/oura-cloud-met'
import { CLOUD_HR_COVER_MS, MET_MINUTE_MS, stillDaytimeRhr } from '@trainingai/shared/health/still-rhr'
import { reportOuraCloudIssue } from './report'

export type StillRhrRepo = Pick<WorkoutRepository,
  'getUserById' | 'getOuraCloudActivitySeries' | 'getOuraHeartrateBySource' | 'listSleepSessions' | 'upsertOuraDailyDerived'>

/** Recomputes these local days (those still to finish are skipped). Never throws. */
export type StillRhrRefresh = (userId: string, days: readonly string[]) => Promise<void>

/** Most days one refresh will recompute, so a long backfill cannot turn into one slow call. */
const MAX_DAYS_PER_REFRESH = 400

/**
 * Computes and stores the value for each completed day in `days`. Returns the days it wrote.
 */
export async function refreshStillRhr(repo: StillRhrRepo, userId: string, days: readonly string[]): Promise<string[]> {
  const tz = (await repo.getUserById(userId))?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const wanted = [...new Set(days)].filter(d => d < today).sort().slice(-MAX_DAYS_PER_REFRESH)
  const written: string[] = []
  for (const day of wanted) {
    const dayStart = dateStrMidnightInTz(day, tz)
    const dayEnd = dateStrMidnightInTz(shiftDateStr(day, 1), tz)
    // Oura's activity day starts at 4 a.m. local, so the day's first hours are in the day before's document.
    const [series, hr, sleep] = await Promise.all([
      repo.getOuraCloudActivitySeries(userId, shiftDateStr(day, -1), day),
      repo.getOuraHeartrateBySource(userId, 'oura_cloud', dayStart, dayEnd),
      // Wake-date keyed: the night that ends this morning, and tonight's if it began before midnight.
      repo.listSleepSessions(userId, day, shiftDateStr(day, 1)),
    ])
    const grid = ouraCloudMetGrid(series, dayStart.getTime(), dayEnd.getTime())
    const met = grid.metsPerMinute.flatMap((value, i) =>
      value == null ? [] : [{ tsMs: grid.startTimestampMs + i * MET_MINUTE_MS, value }])
    const still = stillDaytimeRhr({
      hr: hr.map(h => ({ tsMs: h.timestamp.getTime(), bpm: h.bpm })),
      met,
      sleepWindows: sleep.map(s => ({ startMs: s.sleepStart.getTime(), endMs: s.sleepEnd.getTime() })),
      dayStartMs: dayStart.getTime(),
      dayEndMs: dayEnd.getTime(),
      hrCoverMs: CLOUD_HR_COVER_MS,
    })
    if (!still) continue
    await repo.upsertOuraDailyDerived(userId, day, { stillRhrBpm: still.bpm, stillRhrCoverageMin: still.coverageMin })
    written.push(day)
  }
  return written
}

/** The refresher production hands the ingest paths. A failure is reported and never fails the write it follows. */
export function stillRhrRefresher(repo: StillRhrRepo): StillRhrRefresh {
  return async (userId, days) => {
    if (days.length === 0) return
    try {
      await refreshStillRhr(repo, userId, days)
    } catch (err) {
      reportOuraCloudIssue('still-rhr:failed', err instanceof Error ? err.message : 'unknown', { userId })
    }
  }
}

/**
 * The local days a batch of documents could change the value of: each activity day carrying MET, and
 * the day after it (the first hours of that day are in this document).
 */
export function stillRhrDaysForDocuments(cloudDaily: readonly { date: string; met?: unknown }[]): string[] {
  return cloudDaily.filter(r => r.met != null).flatMap(r => [r.date, shiftDateStr(r.date, 1)])
}

/** The local days between two instants (a heart-rate write's changed span), capped to a week. */
export function stillRhrDaysBetween(from: Date, to: Date, tz: string): string[] {
  const first = toAestDay(from, tz)
  const last = toAestDay(to, tz)
  const out: string[] = []
  for (let d = first; d <= last && out.length < 8; d = shiftDateStr(d, 1)) out.push(d)
  return out
}
