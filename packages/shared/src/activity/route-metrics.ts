import type { RoutePoint } from './route-encoding'

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two points in kilometers. Takes any lat/lng pair — only those
 *  two fields are used — so callers with a plain `{lat, lng}` (no timestamp/elevation) work too. */
export function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Cumulative distance (km) at each point, starting at 0. */
function cumulativeDistancesKm(points: RoutePoint[]): number[] {
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversineDistanceKm(points[i - 1], points[i]))
  }
  return cum
}

/** Total route distance in kilometers. */
export function computeTotalDistanceKm(points: RoutePoint[]): number {
  if (points.length < 2) return 0
  const cum = cumulativeDistancesKm(points)
  return cum[cum.length - 1]
}

export interface Split {
  km: number
  paceSec: number
}

/** Per-completed-km pace, computed from cumulative distance crossing each km boundary. */
export function computeSplits(points: RoutePoint[]): Split[] {
  if (points.length < 2) return []

  const splits: Split[] = []
  let cumDist = 0
  let splitStartTime = points[0].t
  let splitStartDist = 0
  let nextSplitKm = 1

  for (let i = 1; i < points.length; i++) {
    cumDist += haversineDistanceKm(points[i - 1], points[i])
    if (cumDist >= nextSplitKm) {
      const splitDistKm = cumDist - splitStartDist
      const splitTimeSec = (points[i].t - splitStartTime) / 1000
      splits.push({ km: nextSplitKm, paceSec: Math.round(splitTimeSec / splitDistKm) })
      splitStartTime = points[i].t
      splitStartDist = cumDist
      nextSplitKm += 1
    }
  }

  return splits
}

const BEST_EFFORT_DISTANCES_KM: { key: string; km: number }[] = [
  { key: '1km', km: 1 },
  { key: '5km', km: 5 },
]

/** Fastest pace (sec/km) sustained over each of `BEST_EFFORT_DISTANCES_KM`, via sliding window. */
export function computeBestEfforts(points: RoutePoint[]): Record<string, number> {
  const result: Record<string, number> = {}
  if (points.length < 2) return result

  const cum = cumulativeDistancesKm(points)
  const totalDist = cum[cum.length - 1]

  for (const { key, km } of BEST_EFFORT_DISTANCES_KM) {
    if (totalDist < km) continue

    let best = Infinity
    let j = 0
    for (let i = 0; i < points.length; i++) {
      if (j < i) j = i
      while (j < points.length && cum[j] - cum[i] < km) j++
      if (j >= points.length) break
      const timeSec = (points[j].t - points[i].t) / 1000
      const distKm = cum[j] - cum[i]
      const paceForKm = (timeSec / distKm) * km
      if (paceForKm < best) best = paceForKm
    }

    if (best !== Infinity) result[key] = Math.round(best)
  }

  return result
}

export interface PacePoint {
  tSec: number
  paceSec: number
}

/** Pace bucketed every `bucketSec` seconds (default 30s) for a pace-over-time chart. */
export function computePaceSeries(points: RoutePoint[], bucketSec = 30): PacePoint[] {
  if (points.length < 2) return []

  const cum = cumulativeDistancesKm(points)
  const startTime = points[0].t
  const series: PacePoint[] = []
  let bucketStartIdx = 0
  let nextBucketSec = bucketSec

  for (let i = 1; i < points.length; i++) {
    const elapsedSec = (points[i].t - startTime) / 1000
    if (elapsedSec >= nextBucketSec) {
      const distKm = cum[i] - cum[bucketStartIdx]
      const timeSec = (points[i].t - points[bucketStartIdx].t) / 1000
      series.push({ tSec: Math.round(elapsedSec), paceSec: distKm > 0 ? Math.round(timeSec / distKm) : 0 })
      bucketStartIdx = i
      nextBucketSec += bucketSec
    }
  }

  return series
}

/** Total elevation gain and loss in meters, ignoring points without elevation data. */
export function computeElevationChange(points: RoutePoint[]): { gainM: number; lossM: number } {
  let gain = 0
  let loss = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].ele
    const curr = points[i].ele
    if (prev == null || curr == null) continue
    const diff = curr - prev
    if (diff > 0) gain += diff
    else loss += -diff
  }
  return { gainM: Math.round(gain), lossM: Math.round(loss) }
}

export interface ElevationPoint {
  distKm: number
  eleM: number
}

/** Elevation bucketed every `bucketKm` km (default 0.1km) for an elevation-vs-distance chart.
 *  Points without elevation data are skipped — the profile just has fewer entries, matching
 *  computeElevationChange's existing null-skipping behavior rather than fabricating a value. */
export function computeElevationProfile(points: RoutePoint[], bucketKm = 0.1): ElevationPoint[] {
  if (points.length < 2) return []

  const cum = cumulativeDistancesKm(points)
  const profile: ElevationPoint[] = []
  let nextBucketKm = 0

  for (let i = 0; i < points.length; i++) {
    const ele = points[i].ele
    if (ele == null) continue
    if (cum[i] >= nextBucketKm) {
      profile.push({ distKm: Math.round(cum[i] * 100) / 100, eleM: Math.round(ele) })
      nextBucketKm += bucketKm
    }
  }

  return profile
}

/** Average pace in seconds per km, or null if there's no distance to derive a pace from. */
export function computeAvgPaceSecPerKm(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0) return null
  return Math.round(durationSec / distanceKm)
}
