import { Capacitor } from '@capacitor/core';

export const WORKOUT_TIMERS_CHANNEL = 'workout-timers';
const REST_COMPLETE_ID = 9001;

// Passive activity detection: a single heads-up when a walk/run is confirmed and
// recording starts, cleared when the session ends. Deliberately NOT `ongoing` —
// the persistent "recording" chip is the GPS foreground service's own
// notification (see lib/activity/gps-tracking.ts); this is a one-off "we caught
// it" ping so a second permanent chip isn't stacked on top.
export const ACTIVITY_DETECTION_CHANNEL = 'activity-detection';
const ACTIVITY_DETECTED_ID = 9101;
// Group so this collapses under the app's other notifications rather than adding
// a standalone row in the shade.
const ACTIVITY_GROUP = 'trainingai-activity';

export async function notifyActivityDetected(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        id: ACTIVITY_DETECTED_ID,
        title: 'Activity detected',
        body: 'Recording your walk or run…',
        channelId: ACTIVITY_DETECTION_CHANNEL,
        group: ACTIVITY_GROUP,
        autoCancel: true,
        ongoing: false,
      }],
    });
  } catch {}
}

export async function clearActivityDetected(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: ACTIVITY_DETECTED_ID }] });
  } catch {}
}

export type RestNotificationAction =
  | { action: 'schedule'; delayMs: number; setNumber: number }
  | { action: 'cancel' };

export function computeRestNotificationAction(
  workoutPhase: string,
  restStartMs: number | null,
  currentRestSec: number,
  currentSet: number,
  now = Date.now(),
): RestNotificationAction {
  if (workoutPhase === 'rest' && currentRestSec > 0 && restStartMs !== null) {
    const remainingMs = restStartMs + currentRestSec * 1000 - now;
    if (remainingMs > 1000) {
      return { action: 'schedule', delayMs: remainingMs, setNumber: currentSet + 1 };
    }
  }
  return { action: 'cancel' };
}

export async function scheduleRestCompleteNotification(delayMs: number, setNumber: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        id: REST_COMPLETE_ID,
        title: 'Rest complete',
        body: `Time for set ${setNumber}`,
        // allowWhileIdle → setExactAndAllowWhileIdle, so the alert fires on time
        // even when the screen is off or the app is backgrounded (Doze batches
        // ordinary alarms into maintenance windows, delaying rest alerts ~30s).
        schedule: { at: new Date(Date.now() + delayMs), allowWhileIdle: true },
        channelId: WORKOUT_TIMERS_CHANNEL,
      }],
    });
  } catch {}
}

export async function cancelRestCompleteNotification(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: REST_COMPLETE_ID }] });
  } catch {}
}
