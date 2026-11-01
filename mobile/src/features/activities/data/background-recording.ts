import { useSyncExternalStore } from 'react';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';

// Recording with the phone locked (#2846). While a walk, run or guided walk is on, Android keeps
// the app alive with a foreground service (the notification the walker sees), and the location
// updates it carries keep arriving with the screen off. The current app does the same with
// `@capacitor-community/background-geolocation` (`lib/activity/gps-tracking.ts`).
//
// This file holds the parts that need no phone: what the notification says, the one flag the
// strap hold reads, and the start/stop lifecycle. The Android side is `integrations/location`.

/** 'pending' until the permission question is answered; 'on' when the service is running. */
export type BackgroundState = 'off' | 'pending' | 'on' | 'denied' | 'skipped';
export type BackgroundNotification = { title: string; body: string };
export type BackgroundStarted =
  | { result: 'on'; stop(): Promise<void> }
  // The walker said no, or Android would not grant "all the time": screen-on recording, with a notice.
  | { result: 'denied' }
  // Nothing to ask: no location module (browser preview, older build), foreground permission or
  // location off. The foreground watcher reports those on its own.
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

export const BACKGROUND_DENIED_NOTICE =
  'Recording only while the screen is on. Set location to "Allow all the time" in phone settings to keep recording when it is locked.';

// What the Android permission screen is preceded by. Android 11+ cannot show this question in a
// dialog: it sends the walker to settings, so say what to pick before that happens.
export const BACKGROUND_RATIONALE = {
  title: 'Keep recording when the screen is locked',
  message:
    'To record your route with your phone locked in a pocket, TrainingAi needs location set to "Allow all the time". Choose that on the next screen. Without it, the screen has to stay on.',
  allow: 'Continue',
  skip: 'Keep screen on',
};

let running = false;
const listeners = new Set<() => void>();
function setRunning(value: boolean) {
  if (running !== value) {
    running = value;
    listeners.forEach((listener) => listener());
  }
}
/**
 * True while the foreground service is up, so the app is allowed to run with the screen off. The
 * chest-strap hold for an activity (#3527) reads this: `useStrapHold` releases the strap when the
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
 * Starts the service for an activity and returns the stop function. Kept apart from React so the
 * lifecycle can be tested; `useRouteRecording` wraps it. Stopping before the start has answered
 * (the walker finishes while the permission question is open) stops it as soon as it is up.
 */
export function runBackgroundRecording(
  recorder: BackgroundRecorder,
  sink: { appendFix(point: RoutePoint): unknown },
  notification: BackgroundNotification,
  onState: (state: BackgroundState) => void,
) {
  let cancelled = false,
    stop: (() => Promise<void>) | null = null;
  onState('pending');
  recorder
    .start({ notification, fix: (point) => !cancelled && sink.appendFix(point) })
    .then(
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
      () => !cancelled && onState('skipped'),
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
