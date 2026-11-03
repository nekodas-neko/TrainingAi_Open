import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { activityService } from '../../../integrations/activity-service/platform';
import { routeLocation } from '../../../integrations/location/route-location';
import { useStrapSession } from '../../devices/strap/StrapProvider';
import { useActivities } from './ActivityProvider';
import { liveRouteReadout } from './ActivityStore';
import {
  backgroundNotification,
  runActivityService,
  type ActivityServiceStarter,
  type BackgroundState,
} from './background-recording';
import {
  activityServiceKind,
  activityServiceNotice,
  gpsStatus,
  liveRouteStats,
  recordsRoute,
  routeEligible,
  watchRoute,
  runServiceRecording,
  type LocationSource,
  type RouteWatchState,
} from './route-recording';

// Watches GPS while a route-recording activity runs on screen, as the current app's active
// screens do (`active-activity-screen.tsx`, `walk-active.tsx`): the watcher stops on pause and
// starts again on resume. With the phone locked, a foreground service keeps the fixes coming for the
// whole activity, pauses included (#2846). It needs only foreground location permission; if it
// cannot start, or the build has no service, recording stays on the screen-on watcher (with a
// notice when Android refused it).
//
// An activity with no GPS (a treadmill walk, an indoor session) runs the connected-device service
// instead, while a strap is paired, so the strap's link survives the screen going off (#3595). So
// does a GPS recording whose location service had nothing to start. One service at a time:
// `activityServiceKind` picks.
const noSubscribe = () => () => {};
export function useRouteRecording(
  source: LocationSource = routeLocation,
  indoor: ActivityServiceStarter | undefined = activityService,
) {
  const activity = useActivities(),
    store = activity.store,
    session = activity.session;
  const strap = useStrapSession();
  const strapPaired = useSyncExternalStore(
    strap?.subscribe ?? noSubscribe,
    () => !!strap?.getSnapshot().paired,
    () => !!strap?.getSnapshot().paired,
  );
  // The session whose location service answered 'skipped': it falls back to the indoor service.
  const [locationSkipped, setLocationSkipped] = useState<string | null>(null);
  const kind =
    activity.ready && session
      ? activityServiceKind(session, { strapPaired, locationSkipped: locationSkipped === session.id })
      : null;
  const sessionId = session?.id ?? null;
  const recording = activity.ready && !!session && recordsRoute(session);
  const [watch, setWatch] = useState<RouteWatchState>(() => ({
    problem: null,
    lastFixMs: null,
    now: Date.now(),
  }));
  const [attempt, setAttempt] = useState(0);
  // The service runs from Start to Finish or Discard, so a pause does not drop the notification or
  // the strap; the store ignores fixes while paused.
  const serviceWanted = kind === 'location';
  const notification = session ? backgroundNotification(session) : null;
  const [background, setBackground] = useState<BackgroundState>('off');
  const [indoorState, setIndoorState] = useState<BackgroundState>('off');
  useEffect(() => {
    if (!serviceWanted || !store || !notification || !source.background) {
      return;
    }
    // While the service delivers, the screen-on watcher is down, so the service's fixes feed the
    // GPS status and the live pace too.
    const stop = runServiceRecording(
      source.background,
      store,
      notification,
      (state) => {
        if (state === 'skipped' && sessionId) {
          setLocationSkipped(sessionId);
        }
        setBackground(state);
      },
      setWatch,
    );
    return () => {
      stop();
      setBackground('off');
    };
  }, [serviceWanted, store, source, notification?.body, sessionId]);
  useEffect(() => {
    if (kind !== 'connected-device' || !indoor || !notification) {
      return;
    }
    const stop = runActivityService(indoor, notification, setIndoorState);
    return () => {
      stop();
      setIndoorState('off');
    };
  }, [kind, indoor, notification?.body]);
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
  const notice = activityServiceNotice(kind, { location: background, 'connected-device': indoorState });
  return { eligible, status, notice, background, ...stats };
}
