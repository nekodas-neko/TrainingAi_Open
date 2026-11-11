// The Capacitor app's notification channels (#3728). The native app installs over it as the same
// package, and Android keeps a package's channels across an update, so they would stay listed in
// the phone's notification settings for an app that no longer posts to them. Only the real app
// ID has them: Preview and the Dev build never ran the old code.
//
// `health-alerts` is left out on purpose: the native app posts to a channel with that same id.
export const OLD_APP_PACKAGE = 'com.trainingai.app';

export const OLD_APP_CHANNELS: readonly string[] = [
  // components/capacitor-native-init.tsx
  'workout-timers',
  'meal-reminders',
  'supplement-reminders',
  'day-review-reminders',
  'activity-detection',
  'workout-reminders',
  // MainActivity.java
  'rest-timer',
  'run-status',
  // OuraRingService.kt, ScaleBleService.kt and PolarStrapService.kt, with the ids each replaced
  'oura-ble-v2',
  'oura-ble',
  'oura-ble-low-battery',
  'oura-ble-drain-done',
  'scale-ble-v2',
  'scale-ble',
  'scale-ble-pending',
  'scale-ble-skipped',
  'scale-ble-logged',
  'scale-ble-failed',
  'scale-ble-declined',
  'polar-ble-v2',
  'polar-ble',
  'polar-ble-low-battery',
];

type Channels = {
  applicationId: string | null | undefined;
  list: () => Promise<readonly { id: string }[]>;
  remove: (id: string) => Promise<unknown>;
};

/**
 * Deletes whichever of the old app's channels the phone still lists, and returns their ids. It
 * reads the list first, so every run after the first finds nothing and deletes nothing. A channel
 * that fails to delete is left for the next start; it never throws.
 */
export async function removeOldAppChannels({ applicationId, list, remove }: Channels) {
  if (applicationId !== OLD_APP_PACKAGE) return [];
  const removed: string[] = [];
  try {
    const present = new Set((await list()).map((channel) => channel.id));
    for (const id of OLD_APP_CHANNELS) {
      if (!present.has(id)) continue;
      try {
        await remove(id);
        removed.push(id);
      } catch {
        // Left for the next start.
      }
    }
  } catch {
    // The list could not be read: nothing is deleted blind.
  }
  return removed;
}
