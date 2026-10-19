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
import { MAX_PACE_SEC_PER_KM } from '../validation/plausibility'

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
 * `paceElapsedSec` is the denominator of the average pace: the activity's active (unpaused) seconds,
 * the same time its saved duration counts. It is required because the obvious default, the span
 * from the first GPS fix to the last, keeps running through a pause and so counted the paused
 * minutes as running ones (#3092). Splits and the pace series stay on fix time.
 *
 * Null with fewer than two points: one fix is a position, not a route.
 *
 * A pace slower than `MAX_PACE_SEC_PER_KM` never reaches the save schema, which rejects it. A 30 s
 * bucket or a split that spans a pause, or a stop at a crossing, covers a few metres and reads as
 * hours per km; one such value used to make the whole activity unsaveable (#3093 review). Splits
 * that slow are left out (every display keys a split by its km), pace-series buckets are clamped to
 * the cap, and an average that slow (a walk that lost GPS for most of its time) is left out.
 */
export function summariseRoute(points: RoutePoint[], paceElapsedSec: number): RouteSummary | null {
  if (points.length < 2) return null
  const distanceKm = computeTotalDistanceKm(points)
  const { gainM, lossM } = computeElevationChange(points)
  const avgPaceSecPerKm = computeAvgPaceSecPerKm(distanceKm, paceElapsedSec)
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    routePolyline: encodeRoute(simplifyRoute(points, ROUTE_SIMPLIFY_TOLERANCE_M)),
    splits: computeSplits(points).filter(split => split.paceSec <= MAX_PACE_SEC_PER_KM),
    bestEfforts: computeBestEfforts(points),
    // Clamped, not dropped: the route map's scrub marker and HR-zone colours turn the series back
    // into distance bucket by bucket, so a missing bucket would count the pause at running pace.
    paceSeries: computePaceSeries(points).map(point => ({
      ...point,
      paceSec: Math.min(point.paceSec, MAX_PACE_SEC_PER_KM),
    })),
    avgPaceSecPerKm:
      avgPaceSecPerKm != null && avgPaceSecPerKm <= MAX_PACE_SEC_PER_KM ? avgPaceSecPerKm : undefined,
    elevationGainM: gainM,
    elevationLossM: lossM,
    elevationProfile: computeElevationProfile(points),
  }
}
