// The day's stress series as `/api/body-battery/stress-day` serves it (#2860 F1, step 1).
//
// Two rulers, never joined on one day:
//   - **`ring_dhrv`**: the half-hour buckets the ring-era rollup stored in `oura_daytime_stress_buckets`
//     (estimated daytime HRV). Served as stored for any day that has them; history is never recomputed.
//   - **`still_hr`**: computed on read from the generic heart-rate series (§3a, `getHrForWindow`, every
//     source merged) and the generic per-minute movement series (`getPerMinuteMovementSeries`), by
//     `stillHrStressSeries`. Only from the day the user switched sources, and only when nothing is stored.
//
// **Display only.** Nothing here is stored, and no score reads it: Body Battery builds its own stress
// series and falls back to `DaytimeHighStress`; resilience reads the stored buckets. Pinned by
// `still-hr-stress-no-score-2860.test.ts`.
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { beforeSourceSwitch } from '@trainingai/shared/health/source-rank'
import { perMinuteMovementGrid } from '@trainingai/shared/health/per-minute-movement'
import { MET_MINUTE_MS } from '@trainingai/shared/health/still-rhr'
import {
  stillHrNormal, stillHrStressSeries, STILL_HR_NORMAL_WINDOW_DAYS, STILL_HR_STRESS_METHOD,
} from '@trainingai/shared/health/still-hr-stress'

export type StressDayMethod = 'ring_dhrv' | typeof STILL_HR_STRESS_METHOD

export interface StressDaySeries {
  /** 30-minute buckets, ascending by midpoint. `level` is [−1,+1]; negative is stressed. */
  series: { t: number; level: number }[]
  /** Which ruler the levels are on; null when the day has none. */
  method: StressDayMethod | null
}

export type StressDayRepo = Pick<WorkoutRepository,
  'getOuraDaytimeStressBuckets' | 'getOuraCloudSwitchDay' | 'getHrForWindow' | 'getPerMinuteMovementSeries'
  | 'listSleepSessions' | 'getOuraDailyDerived'>

/** `date` is `YYYY-MM-DD` in `tz`. `now` caps today's window so a reading from the future is never read. */
export async function readStressDay(repo: StressDayRepo, userId: string, date: string, tz: string, now = new Date()): Promise<StressDaySeries> {
  const dayStart = dateStrMidnightInTz(date, tz)
  const dayEnd = dateStrMidnightInTz(shiftDateStr(date, 1), tz)

  const [stored, switchDay] = await Promise.all([
    repo.getOuraDaytimeStressBuckets(userId, dayStart, new Date(dayEnd.getTime() - 1)),
    repo.getOuraCloudSwitchDay(userId),
  ])
  if (stored.length > 0) {
    return { series: stored.map(r => ({ t: r.bucketMid.getTime(), level: r.level })), method: 'ring_dhrv' }
  }
  if (beforeSourceSwitch(date, switchDay)) return { series: [], method: null }

  const until = new Date(Math.min(dayEnd.getTime(), Math.max(dayStart.getTime(), now.getTime())))
  const [hr, movement, sleep, derived] = await Promise.all([
    repo.getHrForWindow(userId, dayStart, until),
    // A source's movement day may start before local midnight (Oura's at 4 a.m.), so the day before too.
    repo.getPerMinuteMovementSeries(userId, shiftDateStr(date, -1), date),
    // Wake-date keyed: the night that ends this morning, and tonight's if it began before midnight.
    repo.listSleepSessions(userId, date, shiftDateStr(date, 1)),
    repo.getOuraDailyDerived(userId, shiftDateStr(date, -STILL_HR_NORMAL_WINDOW_DAYS), shiftDateStr(date, -1)),
  ])
  const normalBpm = stillHrNormal(
    [...derived].filter(r => r.day < date).sort((a, b) => a.day.localeCompare(b.day)).map(r => r.stillRhrBpm),
  )
  if (normalBpm == null) return { series: [], method: null }

  const grid = perMinuteMovementGrid(movement, dayStart.getTime(), dayEnd.getTime())
  const met = grid.metsPerMinute.flatMap((value, i) =>
    value == null ? [] : [{ tsMs: grid.startTimestampMs + i * MET_MINUTE_MS, value }])
  const points = stillHrStressSeries({
    hr: hr.map(h => ({ tsMs: h.timestamp.getTime(), bpm: h.bpm })),
    met,
    sleepWindows: sleep.map(s => ({ startMs: s.sleepStart.getTime(), endMs: s.sleepEnd.getTime() })),
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayEnd.getTime(),
    normalBpm,
  })
  return points.length
    ? { series: points.map(p => ({ t: p.t, level: p.level })), method: STILL_HR_STRESS_METHOD }
    : { series: [], method: null }
}
