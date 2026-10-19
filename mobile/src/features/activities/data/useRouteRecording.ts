import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { routeLocation } from '../../../integrations/location/route-location';
import { useActivities } from './ActivityProvider';
import { elapsedMs } from './ActivityStore';
import {
  gpsStatus,
  liveRouteStats,
  recordsRoute,
  routeEligible,
  type LocationProblem,
  type LocationSource,
} from './route-recording';

// Watches GPS while a route-recording activity runs on screen, as the current app's active
// screens do (`active-activity-screen.tsx`, `walk-active.tsx`): the watcher stops on pause and
// starts again on resume. Foreground only until #2846.
export function useRouteRecording(source: LocationSource = routeLocation) {
  const activity = useActivities(),
    store = activity.store,
    session = activity.session;
  const recording = activity.ready && !!session && recordsRoute(session);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const [lastFixMs, setLastFixMs] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!recording || !store) {
      return;
    }
    let stop: (() => void) | null = null,
      cancelled = false;
    setProblem(null);
    setLastFixMs(null);
    source
      .watch({
        fix: (point) => {
          if (cancelled) {
            return;
          }
          setLastFixMs(Date.now());
          setProblem(null);
          store.appendFix(point);
        },
        problem: (next) => {
          if (!cancelled) {
            setProblem(next);
          }
        },
      })
      .then(
        (remove) => (cancelled ? remove() : (stop = remove)),
        () => !cancelled && setProblem('failed'),
      );
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      cancelled = true;
      stop?.();
      clearInterval(timer);
    };
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
      } else if (problem) {
        setAttempt((value) => value + 1);
      }
    });
    return () => listener.remove();
  }, [recording, store, problem]);
  const eligible = !!session && routeEligible(session);
  const status = gpsStatus({
    problem,
    paused: session?.pauseStartMs != null,
    points: activity.route.length,
    lastFixMs,
    now,
  });
  // Pace as of the latest kept fix, over active time, as the current app's appendPoint works it.
  const stats = liveRouteStats(
    activity.route,
    session ? elapsedMs(session, activity.route.at(-1)?.t ?? now) / 1000 : 0,
  );
  return { eligible, status, ...stats };
}
