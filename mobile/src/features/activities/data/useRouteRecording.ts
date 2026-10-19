import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { routeLocation } from '../../../integrations/location/route-location';
import { useActivities } from './ActivityProvider';
import { liveRouteReadout } from './ActivityStore';
import {
  gpsStatus,
  liveRouteStats,
  recordsRoute,
  routeEligible,
  watchRoute,
  type LocationSource,
  type RouteWatchState,
} from './route-recording';

// Watches GPS while a route-recording activity runs on screen, as the current app's active
// screens do (`active-activity-screen.tsx`, `walk-active.tsx`): the watcher stops on pause and
// starts again on resume. Foreground only until #2846.
export function useRouteRecording(source: LocationSource = routeLocation) {
  const activity = useActivities(),
    store = activity.store,
    session = activity.session;
  const recording = activity.ready && !!session && recordsRoute(session);
  const [watch, setWatch] = useState<RouteWatchState>(() => ({
    problem: null,
    lastFixMs: null,
    now: Date.now(),
  }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!recording || !store) {
      return;
    }
    return watchRoute(source, store, setWatch);
  }, [recording, store, source, attempt]);
  useEffect(() => {
    if (!recording || !store) {
      return;
    }
    // Leaving the app writes the route now, so a kill in the background keeps it. Coming back
    // after turning location on, or allowing it in settings, tries the watcher again.
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void store.checkpoint().catch(() => {});
      } else if (watch.problem) {
        setAttempt((value) => value + 1);
      }
    });
    return () => listener.remove();
  }, [recording, store, watch.problem]);
  const eligible = !!session && routeEligible(session);
  const status = gpsStatus({
    problem: watch.problem,
    paused: session?.pauseStartMs != null,
    points: activity.route.length,
    lastFixMs: watch.lastFixMs,
    now: watch.now,
  });
  const stats = session
    ? liveRouteReadout(session, activity.route, watch.now)
    : liveRouteStats(activity.route, 0);
  return { eligible, status, ...stats };
}
