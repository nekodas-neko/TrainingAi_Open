import { haversineDistanceKm } from './activity-metrics'

export interface LatLng {
  lat: number
  lng: number
}

export interface PacePoint {
  tSec: number
  paceSec: number
}

/** Cumulative distance (km) covered by elapsed time `tSec`, integrating a `computePaceSeries`
 *  result bucket by bucket (speed = 1km / paceSec). The bucket containing `tSec` is weighted
 *  by the fraction of it elapsed. Clamps to the series' total distance past the last bucket. */
export function estimateDistanceKmAtTime(paceSeries: PacePoint[], tSec: number): number {
  let distanceKm = 0
  let prevT = 0
  for (const p of paceSeries) {
    if (tSec <= prevT) break
    const bucketSec = p.tSec - prevT
    const elapsedInBucket = Math.min(bucketSec, tSec - prevT)
    distanceKm += elapsedInBucket / p.paceSec
    prevT = p.tSec
    if (tSec <= p.tSec) break
  }
  return distanceKm
}

/** Inverse of `estimateDistanceKmAtTime`: the elapsed time (sec) at which cumulative distance
 *  first reaches `targetKm`, integrating the same `paceSeries` bucket-by-bucket. Returns the
 *  series' last `tSec` if `targetKm` exceeds the total distance the series covers. */
export function estimateTimeAtDistanceKm(paceSeries: PacePoint[], targetKm: number): number {
  let distanceKm = 0
  let prevT = 0
  for (const p of paceSeries) {
    const bucketSec = p.tSec - prevT
    const bucketKm = bucketSec / p.paceSec
    if (distanceKm + bucketKm >= targetKm) {
      return prevT + (targetKm - distanceKm) * p.paceSec
    }
    distanceKm += bucketKm
    prevT = p.tSec
  }
  return prevT
}

/** Walks a route's lat/lng points accumulating haversine distance, returning the point at
 *  `targetKm` via linear interpolation between the two bracketing points. Returns the route's
 *  last point past its total length, or null for fewer than 2 points — the caller (the hero
 *  chart's scrub handler) treats null as "don't move the map marker". */
export function pointAtDistanceKm(points: LatLng[], targetKm: number): LatLng | null {
  if (points.length < 2) return null
  if (targetKm <= 0) return points[0]

  let cumKm = 0
  for (let i = 1; i < points.length; i++) {
    const segKm = haversineDistanceKm(points[i - 1], points[i])
    if (cumKm + segKm >= targetKm) {
      const frac = segKm > 0 ? (targetKm - cumKm) / segKm : 0
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * frac,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * frac,
      }
    }
    cumKm += segKm
  }
  return points[points.length - 1]
}
