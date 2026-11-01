import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { routeLocation } from '../../../integrations/location/route-location';
import { useActivities } from './ActivityProvider';
import { liveRouteReadout } from './ActivityStore';
import {
  BACKGROUND_DENIED_NOTICE,
  backgroundNotification,
  runBackgroundRecording,
  type BackgroundState,
} from './background-recording';
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
// starts again on resume. With the phone locked, a foreground service keeps the fixes coming for the
// whole activity, pauses included (#2846); if the walker will not allow that, or the build has no
// service, recording stays on the screen-on watcher with a notice.
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
  // The service runs from Start to Finish or Discard, so a pause does not drop the notification or
  // the strap; the store ignores fixes while paused.
  const serviceWanted =
    activity.ready && !!session && session.mode === 'active' && routeEligible(session);
  const notification = session ? backgroundNotification(session) : null;
  const [background, setBackground] = useState<BackgroundState>('off');
  useEffect(() => {
    if (!serviceWanted || !store || !notification || !source.background) {
      return;
    }
    const stop = runBackgroundRecording(source.background, store, notification, setBackground);
    return () => {
      stop();
      setBackground('off');
    };
  }, [serviceWanted, store, source, notification?.body]);
  // One source of fixes at a time: the screen-on watcher waits for the permission answer, and
  // stands down while the service is delivering.
  const awaitingBackground =
    serviceWanted && !!source.background && (background === 'off' || background === 'pending');
  useEffect(() => {
    if (!recording || !store || awaitingBackground || background === 'on') {
      return;
    }
    return watchRoute(source, store, setWatch);
  }, [recording, store, source, attempt, awaitingBackground, background === 'on']);
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
  const notice = eligible && background === 'denied' ? BACKGROUND_DENIED_NOTICE : null;
  return { eligible, status, notice, background, ...stats };
}
