import { Capacitor } from '@capacitor/core';

export const WORKOUT_TIMERS_CHANNEL = 'workout-timers';
const REST_COMPLETE_ID = 9001;

// #3844: the "Activity detected" notification went with the phone's live walk detector. Its channel
// id stays named so `CapacitorNativeInit` can delete the channel a device created before then.
export const ACTIVITY_DETECTION_CHANNEL = 'activity-detection';

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
