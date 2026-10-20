import { computeHrZones } from '@trainingai/shared/health/hr-zones';
import { zoneBreakdownFromReadings } from '@trainingai/shared/health/zone-minutes';
import { buildRouteZoneSegments } from '@trainingai/shared/activity/route-hr-zones';
import type { LatLng } from '@trainingai/shared/activity/scrub';

type Reading = { timestamp: string; bpm: number };

/**
 * The activity detail's two zone products: the Time in Zone breakdown and the HR-coloured route
 * segments. Pure, so the screen can memoise it on its data and a chart tap does not redo it.
 */
export function activityZoneModel({
  maxHr,
  restingHr,
  readings,
  routePoints,
  paceSeries,
  start,
  end,
}: {
  maxHr: number | null | undefined;
  restingHr: number | null | undefined;
  readings: Reading[];
  routePoints: LatLng[];
  paceSeries: { tSec: number; paceSec: number }[];
  start: number | null;
  end: number | null;
}) {
  if (maxHr == null || restingHr == null) {
    return { zones: null, zoneSegments: null };
  }
  const hrZones = computeHrZones({ maxHr, restingHr });
  const zones =
    readings.length > 1
      ? zoneBreakdownFromReadings(
          readings.map((p) => ({ timestamp: Date.parse(p.timestamp), bpm: p.bpm })),
          hrZones,
        )
      : null;
  const zoneSegments =
    readings.length && start != null && !Number.isNaN(start)
      ? buildRouteZoneSegments({
          points: routePoints,
          paceSeries,
          hrReadings: readings,
          zones: hrZones,
          startTime: new Date(start).toISOString(),
          endTime: end != null && !Number.isNaN(end) ? new Date(end).toISOString() : undefined,
        })
      : null;
  return { zones, zoneSegments };
}
