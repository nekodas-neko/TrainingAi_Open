import { haversineDistanceKm } from './activity-metrics'
import { estimateTimeAtDistanceKm, type LatLng, type PacePoint } from './scrub'
import { zoneForBpm, type HrZone } from '@trainingai/shared/health/hr-zones'

interface HrReading {
  timestamp: string
  bpm: number
}

export interface RouteZoneRun {
  /** >=2 consecutive route points sharing one HR-zone color; runs share their boundary point
   *  with their neighbours so drawing them back-to-back leaves no visual gap. */
  positions: LatLng[]
  color: string
}

/** Fallback for a run whose midpoint has no nearby HR reading — matches the flat single-color
 *  line used when there's no HR data to color by at all. */
const NO_READING_COLOR = 'var(--color-brand)'

/** Nearest bpm reading to a wall-clock timestamp (ms since epoch). Assumes `readings` is
 *  chronologically ordered, as returned by the HR-window API. */
function nearestBpm(readings: HrReading[], targetMs: number): number | null {
  if (readings.length === 0) return null
  let lo = 0
  let hi = readings.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (new Date(readings[mid].timestamp).getTime() < targetMs) lo = mid + 1
    else hi = mid
  }
  let best = lo
  if (lo > 0) {
    const prevDiff = Math.abs(new Date(readings[lo - 1].timestamp).getTime() - targetMs)
    const loDiff = Math.abs(new Date(readings[lo].timestamp).getTime() - targetMs)
    if (prevDiff < loDiff) best = lo - 1
  }
  return readings[best].bpm
}

/**
 * Splits a GPS route into runs of consecutive points sharing one HR-zone color, so the map can
 * draw "where was I pushing harder" instead of one flat line. Correlates each segment's
 * along-route distance to elapsed time, then elapsed time to a wall-clock HR reading — route
 * points don't carry their own timestamps, since the encoded polyline format only stores lat/lng.
 *
 * Prefers the real `paceSeries` (the same distance/time model the map's scrub marker already
 * uses) when available. Older logs — or any activity where a pace series wasn't captured —
 * fall back to assuming constant pace across the whole route, using just the start/end time.
 * Less precise (a route with an uneven pace will have its zone boundaries land slightly off),
 * but still far better than no coloring at all, and needs nothing beyond what every GPS
 * activity already stores.
 *
 * Returns null when there isn't enough data to correlate at all (fewer than 2 points, no HR
 * readings, or neither a pace series nor an end time) — the caller falls back to the map's flat
 * single-color line.
 */
export function buildRouteZoneSegments({
  points,
  paceSeries,
  hrReadings,
  zones,
  startTime,
  endTime,
}: {
  points: LatLng[]
  paceSeries: PacePoint[]
  hrReadings: HrReading[]
  zones: HrZone[]
  /** ISO-ish datetime string (no offset) parsed via `new Date()` in the caller's local zone —
   *  callers combine a bare `HH:MM` activity start/end time with its date before calling this. */
  startTime: string
  /** Only needed for the constant-pace fallback (unused when `paceSeries` has data). */
  endTime?: string
}): RouteZoneRun[] | null {
  if (points.length < 2 || hrReadings.length === 0) return null

  let tSecAtKm: (km: number) => number
  if (paceSeries.length > 0) {
    tSecAtKm = (km) => estimateTimeAtDistanceKm(paceSeries, km)
  } else if (endTime) {
    const startMs0 = new Date(startTime).getTime()
    const totalDurationSec = (new Date(endTime).getTime() - startMs0) / 1000
    let totalKm = 0
    for (let k = 0; k < points.length - 1; k++) totalKm += haversineDistanceKm(points[k], points[k + 1])
    if (totalDurationSec <= 0 || totalKm <= 0) return null
    tSecAtKm = (km) => (km / totalKm) * totalDurationSec
  } else {
    return null
  }

  const startMs = new Date(startTime).getTime()
  const segColors: string[] = []
  let cumKm = 0
  for (let k = 0; k < points.length - 1; k++) {
    const segKm = haversineDistanceKm(points[k], points[k + 1])
    const midKm = cumKm + segKm / 2
    const tSec = tSecAtKm(midKm)
    const bpm = nearestBpm(hrReadings, startMs + tSec * 1000)
    segColors.push(bpm != null ? zoneForBpm(bpm, zones).color : NO_READING_COLOR)
    cumKm += segKm
  }

  const runs: RouteZoneRun[] = []
  let runStart = 0
  for (let k = 1; k <= segColors.length; k++) {
    if (k === segColors.length || segColors[k] !== segColors[runStart]) {
      runs.push({ positions: points.slice(runStart, k + 1), color: segColors[runStart] })
      runStart = k
    }
  }
  return runs
}
