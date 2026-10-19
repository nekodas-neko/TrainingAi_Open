import { z } from 'zod';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';
import {
  haversineDistanceKm,
  computeAvgPaceSecPerKm,
  computeElevationChange,
  computeSplits,
  computeTotalDistanceKm,
} from '@trainingai/shared/activity/route-metrics';

export type { RoutePoint };
export const routePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ele: z.number().finite().optional(),
  t: z.number().finite(),
});

// What the location adapter can report besides a fix. "denied", "approximate" (precise location
// off) and "disabled" are the user's settings; "unavailable" is a build without the location module (the browser preview).
export type LocationProblem = 'denied' | 'approximate' | 'disabled' | 'unavailable' | 'failed';
export type LocationSource = {
  watch(handlers: {
    fix(point: RoutePoint): void;
    problem(problem: LocationProblem): void;
  }): Promise<() => void>;
};

// The current app's watcher drops fixes under 5 m from the last one (`distanceFilter: 5` in
// `lib/activity/gps-tracking.ts`), which keeps a standing walker's GPS jitter out of the distance.
// Android's own distance filter would also stop the fixes, and with them any sign that the signal
// is still there, so the filter is applied here and the dropped fixes still count as signal.
export const ROUTE_DISTANCE_FILTER_M = 5;
export function keepsFix(last: RoutePoint | undefined, next: RoutePoint) {
  return (
    !last || (next.t > last.t && haversineDistanceKm(last, next) * 1000 >= ROUTE_DISTANCE_FILTER_M)
  );
}

export type GpsStatus = LocationProblem | 'paused' | 'searching' | 'lost' | 'tracking';
// No fix for this long reads as a dropped signal rather than standing still: the adapter asks
// for a fix every few seconds whether or not the walker moves.
export const GPS_LOST_AFTER_MS = 30_000;

export function gpsStatus({
  problem,
  paused,
  points,
  lastFixMs,
  now,
}: {
  problem: LocationProblem | null;
  paused: boolean;
  points: number;
  lastFixMs: number | null;
  now: number;
}): GpsStatus {
  if (paused) {
    return 'paused';
  }
  if (problem) {
    return problem;
  }
  if (points === 0 || lastFixMs === null) {
    return 'searching';
  }
  return now - lastFixMs > GPS_LOST_AFTER_MS ? 'lost' : 'tracking';
}

// What the guided walk shows under its timer when there is no distance yet.
export const gpsProblemText: Record<Exclude<GpsStatus, 'tracking' | 'paused'>, string> = {
  searching: 'Waiting for GPS',
  lost: 'GPS signal lost',
  denied: 'Location permission is off',
  approximate: 'Precise location is off',
  disabled: 'Location services are off',
  unavailable: 'GPS is not available on this device',
  failed: 'GPS stopped',
};
export const gpsStatusText: Record<GpsStatus, string> = {
  paused: 'Paused',
  tracking: 'Recording',
  searching: `Recording · ${gpsProblemText.searching}`,
  lost: `Recording · ${gpsProblemText.lost}`,
  denied: `Recording time only · ${gpsProblemText.denied}`,
  approximate: `Recording time only · ${gpsProblemText.approximate}`,
  disabled: `Recording time only · ${gpsProblemText.disabled}`,
  unavailable: `Recording time only · ${gpsProblemText.unavailable}`,
  failed: `Recording time only · ${gpsProblemText.failed}`,
};

// The live readout, from the same functions the current app's activity screen uses
// (`lib/stores/activity-store.ts` appendPoint, `run-active-screen.tsx`). Distance is null until
// the first fix, so "no fix yet" never reads as 0 km; one fix and no movement is a real 0.
export function liveRouteStats(points: RoutePoint[], activeSec: number) {
  if (points.length === 0) {
    return { distanceKm: null, paceSecPerKm: null, gainM: null, lossM: null, splits: [] };
  }
  const distanceKm = computeTotalDistanceKm(points);
  const elevation = points.length > 1 ? computeElevationChange(points) : null;
  return {
    distanceKm,
    paceSecPerKm: computeAvgPaceSecPerKm(distanceKm, activeSec),
    gainM: elevation?.gainM ?? null,
    lossM: elevation?.lossM ?? null,
    splits: computeSplits(points),
  };
}

// Only a recording that moves records a route: a manual distance-based activity or an outdoor
// guided walk. A fitness test asks for its distance on the result screen, as in the current app.
export function routeEligible(session: {
  type: { isDistanceBased: boolean };
  guidance?: { kind: string };
}) {
  return session.type.isDistanceBased && (!session.guidance || session.guidance.kind === 'walk');
}
export function recordsRoute(session: {
  mode: string;
  pauseStartMs: number | null;
  type: { isDistanceBased: boolean };
  guidance?: { kind: string };
}) {
  return session.mode === 'active' && session.pauseStartMs === null && routeEligible(session);
}
