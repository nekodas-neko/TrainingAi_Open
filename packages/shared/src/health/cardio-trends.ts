import { weekStartForDay } from '@trainingai/shared/date-utils'

export interface WeeklyZoneStack {
  weekStart: string
  seconds: [number, number, number, number, number]
}

/** Buckets daily per-zone seconds (from `getZoneMinutesRange`) into Mon-Sun week totals. */
export function bucketZoneMinutesByWeek(
  days: { day: string; seconds: [number, number, number, number, number] }[],
): WeeklyZoneStack[] {
  const byWeek = new Map<string, [number, number, number, number, number]>()
  for (const row of days) {
    const weekStart = weekStartForDay(row.day)
    const existing = byWeek.get(weekStart) ?? [0, 0, 0, 0, 0]
    byWeek.set(weekStart, [
      existing[0] + row.seconds[0],
      existing[1] + row.seconds[1],
      existing[2] + row.seconds[2],
      existing[3] + row.seconds[3],
      existing[4] + row.seconds[4],
    ])
  }
  return [...byWeek.entries()]
    .map(([weekStart, seconds]) => ({ weekStart, seconds }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface EfficiencyPoint {
  date: string
  avgHr: number
  avgPaceSecPerKm: number
}

/** Per-run pace-vs-HR points, oldest first. A run needs both an avg HR reading and a GPS pace
 *  to plot — one with no HR data, or a non-distance session, contributes nothing here. */
export function buildEfficiencyCurve(
  logs: { date: string; avgHr?: number; avgPaceSecPerKm?: number }[],
): EfficiencyPoint[] {
  return logs
    .filter((l): l is { date: string; avgHr: number; avgPaceSecPerKm: number } =>
      l.avgHr != null && l.avgPaceSecPerKm != null)
    .map((l) => ({ date: l.date, avgHr: l.avgHr, avgPaceSecPerKm: l.avgPaceSecPerKm }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface CadenceTrendPoint {
  date: string
  cadenceSpm: number
}

/** Per-run average cadence, oldest first — only runs with a measured cadence contribute. */
export function buildCadenceTrend(
  logs: { date: string; cadenceSpm?: number }[],
): CadenceTrendPoint[] {
  return logs
    .filter((l): l is { date: string; cadenceSpm: number } => l.cadenceSpm != null)
    .map((l) => ({ date: l.date, cadenceSpm: l.cadenceSpm }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface RunningBests {
  /** Fastest 1km, in seconds — `bestEfforts['1km']` is already a per-km pace, so this
   *  doubles as "best pace over 1km". */
  best1kSec: number | null
  /** Fastest 5km, in seconds — `bestEfforts['5km']` is the total time for that window,
   *  not a per-km pace (see computeBestEfforts). */
  best5kSec: number | null
  bestAvgPaceSecPerKm: number | null
  longestDistanceKm: number | null
  totalRuns: number
}

/** All-time bests across a user's run activity logs. Nulls mean no run has that data yet
 *  (e.g. a treadmill/indoor run with no GPS never populates bestEfforts). */
export function computeRunningBests(
  logs: { bestEfforts?: Record<string, number>; avgPaceSecPerKm?: number; distanceKm?: number }[],
): RunningBests {
  let best1kSec: number | null = null
  let best5kSec: number | null = null
  let bestAvgPaceSecPerKm: number | null = null
  let longestDistanceKm: number | null = null

  for (const log of logs) {
    const e1k = log.bestEfforts?.['1km']
    if (e1k != null && (best1kSec == null || e1k < best1kSec)) best1kSec = e1k
    const e5k = log.bestEfforts?.['5km']
    if (e5k != null && (best5kSec == null || e5k < best5kSec)) best5kSec = e5k
    if (log.avgPaceSecPerKm != null && (bestAvgPaceSecPerKm == null || log.avgPaceSecPerKm < bestAvgPaceSecPerKm)) {
      bestAvgPaceSecPerKm = log.avgPaceSecPerKm
    }
    if (log.distanceKm != null && (longestDistanceKm == null || log.distanceKm > longestDistanceKm)) {
      longestDistanceKm = log.distanceKm
    }
  }

  return { best1kSec, best5kSec, bestAvgPaceSecPerKm, longestDistanceKm, totalRuns: logs.length }
}
