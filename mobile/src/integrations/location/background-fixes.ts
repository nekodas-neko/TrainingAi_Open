import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';

// The hand-off between Android's location task and the open activity. The task is defined once at
// app start (`background-task.native.ts`) and Android calls it for every batch of fixes, with the
// screen on or off; the recorder points `sink` at the activity's store for as long as it runs.
export const BACKGROUND_LOCATION_TASK = 'trainingai-activity-location';

let sink: ((point: RoutePoint) => void) | null = null;
export const setBackgroundFixSink = (next: ((point: RoutePoint) => void) | null) => {
  sink = next;
};

type TaskLocation = {
  coords: { latitude: number; longitude: number; altitude: number | null };
  timestamp: number;
};

/** Passes a batch to the activity, oldest first, shaped exactly as the screen-on watcher's fixes. */
export function deliverBackgroundLocations(locations: readonly TaskLocation[] | undefined) {
  if (!sink || !locations) {
    return 0;
  }
  const ordered = [...locations].sort((a, b) => a.timestamp - b.timestamp);
  for (const fix of ordered) {
    sink({
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      ...(fix.coords.altitude != null ? { ele: fix.coords.altitude } : {}),
      t: fix.timestamp,
    });
  }
  return ordered.length;
}
