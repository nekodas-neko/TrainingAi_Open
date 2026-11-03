import { useSyncExternalStore } from 'react';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';

// Recording with the phone locked (#2846). While a walk, run or guided walk is on, Android keeps
// the app alive with a foreground service (the notification the walker sees), and the location
// updates it carries keep arriving with the screen off. The current app does the same with
// `@capacitor-community/background-geolocation` (`lib/activity/gps-tracking.ts`).
//
// The service needs only foreground location permission: expo-location's
// `startLocationUpdatesAsync` skips the "Allow all the time" check when `foregroundService` is set
// (its source says so), the service counts as in use. This file holds the parts that need no phone:
// what the notification says, the one flag the strap hold reads, and the start/stop lifecycle. The
// Android side is `integrations/location`.

/** 'pending' until the service has answered; 'on' when it is running; 'failed' when Android refused it. */
export type BackgroundState = 'off' | 'pending' | 'on' | 'failed' | 'skipped';
export type BackgroundNotification = { title: string; body: string };
export type BackgroundStarted =
  | { result: 'on'; stop(): Promise<void> }
  // Android would not start the service (e.g. ForegroundServiceStartNotAllowed): screen-on
  // recording, with a notice so the walker is not misled.
  | { result: 'failed' }
  // Nothing to start: no location module (browser preview, older build), foreground permission
  // denied or location off. The foreground watcher reports those on its own.
  | { result: 'skipped' };
export type BackgroundRecorder = {
  start(options: {
    notification: BackgroundNotification;
    fix(point: RoutePoint): void;
  }): Promise<BackgroundStarted>;
};

// The current app's service notification: 'TrainingAI · Activity' over 'Tracking your walk or run'
// (`lib/activity/gps-tracking.ts`). Naming the activity is the one change. Android shows the
// title and body as given: a live elapsed time would need a service of our own (asked on #2846).
export function backgroundNotification(session: {
  type: { label: string };
  guidance?: { kind: string };
}): BackgroundNotification {
  const what = session.guidance ? 'guided walk' : session.type.label.toLowerCase();
  return { title: 'TrainingAI · Activity', body: `Tracking your ${what}` };
}

export const BACKGROUND_FAILED_NOTICE = 'Recording continues only while the screen is on.';

let running = false;
const listeners = new Set<() => void>();
function setRunning(value: boolean) {
  if (running !== value) {
    running = value;
    listeners.forEach((listener) => listener());
  }
}
/**
 * True while either activity service is up (the GPS one or the indoor one), so the app is allowed
 * to run with the screen off. The chest-strap hold for an activity (#3527, #3595) reads this: `useStrapHold` releases the strap when the
 * app leaves the foreground, which an activity with the service running must not.
 */
export const isActivityServiceRunning = () => running;
export const subscribeActivityService = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useActivityServiceRunning = () =>
  useSyncExternalStore(subscribeActivityService, isActivityServiceRunning);

/**
 * The service for an activity with no GPS (#3595): a connected-device foreground service that only
 * keeps the app alive, so the strap's link survives the screen going off. It needs no location
 * permission. The Android side is `integrations/activity-service`.
 */
export type ActivityServiceStarter = {
  start(options: { notification: BackgroundNotification }): Promise<BackgroundStarted>;
};

/**
 * Starts a service and returns the stop function, publishing whether it runs for the strap hold.
 * Kept apart from React so the lifecycle can be tested. Stopping before the start has answered
 * (the walker finishes while the permission question is open) stops it as soon as it is up.
 */
export function runForegroundService(
  start: () => Promise<BackgroundStarted>,
  onState: (state: BackgroundState) => void,
) {
  let cancelled = false,
    stop: (() => Promise<void>) | null = null;
  onState('pending');
  start().then(
    async (started) => {
      if (started.result !== 'on') {
        if (!cancelled) {
          onState(started.result);
        }
        return;
      }
      if (cancelled) {
        await started.stop().catch(() => {});
        return;
      }
      stop = started.stop;
      setRunning(true);
      onState('on');
    },
    () => !cancelled && onState('failed'),
  );
  return () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    setRunning(false);
    void stop?.().catch(() => {});
  };
}

/** The indoor service run `useRouteRecording` mounts for an activity with no GPS. */
export function runActivityService(
  service: ActivityServiceStarter,
  notification: BackgroundNotification,
  onState: (state: BackgroundState) => void,
) {
  return runForegroundService(() => service.start({ notification }), onState);
}

/** The GPS service: as `runForegroundService`, with its fixes going to the store until stopped. */
export function runBackgroundRecording(
  recorder: BackgroundRecorder,
  sink: { appendFix(point: RoutePoint): unknown },
  notification: BackgroundNotification,
  onState: (state: BackgroundState) => void,
  onFix?: () => void,
) {
  let stopped = false;
  const stop = runForegroundService(
    () =>
      recorder.start({
        notification,
        fix: (point) => {
          if (!stopped) {
            sink.appendFix(point);
            onFix?.();
          }
        },
      }),
    onState,
  );
  return () => {
    stopped = true;
    stop();
  };
}
