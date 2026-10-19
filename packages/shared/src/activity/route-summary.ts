import type { RoutePoint } from './route-encoding'
import { simplifyRoute, encodeRoute } from './route-encoding'
import {
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeElevationProfile,
  computeAvgPaceSecPerKm,
  type Split,
  type PacePoint,
  type ElevationPoint,
} from './route-metrics'

export const ROUTE_SIMPLIFY_TOLERANCE_M = 5

export interface RouteSummary {
  distanceKm: number
  routePolyline: string
  splits: Split[]
  bestEfforts: Record<string, number>
  paceSeries: PacePoint[]
  avgPaceSecPerKm?: number
  elevationGainM: number
  elevationLossM: number
  elevationProfile: ElevationPoint[]
}

/**
 * The route fields an activity log saves, from the raw GPS points. One builder for the current
 * app's activity screen, its guided walk and TrainingAi Preview (#2845), which used to each spell
 * the same nine fields out by hand.
 *
 * `paceElapsedSec` is the denominator of the average pace and is the caller's choice, because the
 * two current-app screens differ: the activity screen uses the GPS fix span (so the pace reconciles
 * with the splits, which also run on fix time), the guided walk uses the walk's own elapsed time.
 * Omitted, it is the fix span.
 *
 * Null with fewer than two points: one fix is a position, not a route.
 */
export function summariseRoute(points: RoutePoint[], paceElapsedSec?: number): RouteSummary | null {
  if (points.length < 2) return null
  const distanceKm = computeTotalDistanceKm(points)
  const { gainM, lossM } = computeElevationChange(points)
  const fixSpanSec = (points[points.length - 1].t - points[0].t) / 1000
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    routePolyline: encodeRoute(simplifyRoute(points, ROUTE_SIMPLIFY_TOLERANCE_M)),
    splits: computeSplits(points),
    bestEfforts: computeBestEfforts(points),
    paceSeries: computePaceSeries(points),
    avgPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, paceElapsedSec ?? fixSpanSec) ?? undefined,
    elevationGainM: gainM,
    elevationLossM: lossM,
    elevationProfile: computeElevationProfile(points),
  }
}
