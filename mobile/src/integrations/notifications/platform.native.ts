import { requireOptionalNativeModule } from 'expo';
import { AppState, Platform } from 'react-native';
import { inPictureInPicture } from '../feedback/beep';
import { feedback, restFeedback } from '../feedback/haptics';
import { restSoundSource } from '../feedback/rest-cue';
import {
  ALERT_OWNER,
  alertSignature,
  type Alert,
} from '../../features/platform/data/models';
export function alertsAvailable() {
  return !!requireOptionalNativeModule('ExpoNotificationScheduler');
}
let initialized: Promise<typeof import('expo-notifications')> | null = null;
async function sdk() {
  if (!alertsAvailable())
    throw new Error('Install the latest development build to enable notifications.');
  return (initialized ??= (async () => {
    const notifications = await import('expo-notifications');
    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('training-timers', {
        name: 'Workout & walk timers',
        importance: notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 150, 250],
      });
      await notifications.setNotificationChannelAsync('training-reminders', {
        name: 'Training reminders',
        importance: notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    }
    notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const ours = notification.request.content.data?.owner === ALERT_OWNER;
        const rest = ours && notification.request.identifier.includes(':rest:');
        const foregroundRest = rest && AppState.currentState === 'active';
        // On screen, the app's own beep is the rest's one sound (#3110): the channel's follows the
        // ringer and would be a second sound, or the only one and silent on vibrate.
        const source = restSoundSource(
          AppState.currentState === 'active'
            ? 'foreground'
            : inPictureInPicture()
              ? 'pip'
              : 'background',
          true,
        );
        return {
          shouldPlaySound: ours && (!rest || source === 'channel'),
          shouldSetBadge: false,
          shouldShowBanner: !foregroundRest,
          shouldShowList: !foregroundRest,
        };
      },
    });
    notifications.addNotificationReceivedListener((notification) => {
      if (
        AppState.currentState === 'active' &&
        notification.request.content.data?.owner === ALERT_OWNER &&
        ['workout', 'walk'].includes(String(notification.request.content.data?.target))
      ) {
        const restCueId = notification.request.content.data?.restCueId;
        if (typeof restCueId === 'string') restFeedback(restCueId);
        else feedback('success', true);
      }
    });
    return notifications;
  })());
}
export async function alertPermission(request = false) {
  if (!alertsAvailable()) {
    if (request) await sdk();
    return false;
  }
  const notifications = await sdk();
  const permission = request
    ? await notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      })
    : await notifications.getPermissionsAsync();
  return (
    permission.granted ||
    permission.ios?.status === notifications.IosAuthorizationStatus.PROVISIONAL
  );
}
export const nativeAlerts = {
  async list() {
    if (!alertsAvailable()) return [];
    const notifications = await sdk();
    const [pending, presented] = await Promise.all([
      notifications.getAllScheduledNotificationsAsync(),
      notifications.getPresentedNotificationsAsync(),
    ]);
    const pendingIds = new Set(pending.map((row) => row.identifier));
    return [
      ...pending,
      ...presented
        .map((row) => row.request)
        .filter((row) => !pendingIds.has(row.identifier)),
    ]
      .filter((row) => row.content.data?.owner === ALERT_OWNER)
      .map((row) => ({
        id: row.identifier,
        signature: String(row.content.data?.signature ?? ''),
      }));
  },
  async cancel(id: string) {
    if (alertsAvailable()) {
      const notifications = await sdk();
      await notifications.cancelScheduledNotificationAsync(id);
      await notifications.dismissNotificationAsync(id);
    }
  },
  async schedule(alert: Alert) {
    const notifications = await sdk();
    const timer = 'at' in alert.trigger;
    const channelId = timer ? 'training-timers' : 'training-reminders';
    if ('at' in alert.trigger && alert.trigger.at <= Date.now()) return;
    const trigger: import('expo-notifications').NotificationTriggerInput =
      'at' in alert.trigger
        ? {
            type: notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(alert.trigger.at),
            channelId,
          }
        : alert.trigger.weekday !== undefined
          ? {
              type: notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: alert.trigger.weekday + 1,
              hour: alert.trigger.hour,
              minute: alert.trigger.minute,
              channelId,
            }
          : {
              type: notifications.SchedulableTriggerInputTypes.DAILY,
              hour: alert.trigger.hour,
              minute: alert.trigger.minute,
              channelId,
            };
    await notifications.scheduleNotificationAsync({
      identifier: alert.id,
      content: {
        title: alert.title,
        body: alert.body,
        sound: 'default',
        data: {
          owner: ALERT_OWNER,
          scope: alert.scope,
          target: alert.target,
          recordId: alert.recordId ?? null,
          restCueId: alert.restCueId ?? null,
          signature: alertSignature(alert),
        },
      },
      trigger,
    });
  },
};
export async function observeAlerts(onOpen: (data: Record<string, unknown>) => void) {
  if (!alertsAvailable()) return () => {};
  const notifications = await sdk();
  const opened = new Set<string>();
  function handle(response: import('expo-notifications').NotificationResponse | null) {
    const data = response?.notification.request.content.data;
    if (!response || data?.owner !== ALERT_OWNER) return;
    const id = `${response.notification.request.identifier}:${response.notification.date}`;
    if (opened.has(id)) return;
    opened.add(id);
    onOpen({ ...data, responseId: id });
    void notifications.clearLastNotificationResponseAsync().catch(() => {});
  }
  handle(await notifications.getLastNotificationResponseAsync());
  const listener = notifications.addNotificationResponseReceivedListener(handle);
  return () => listener.remove();
}
/**
 * A one-off device alert, shown now, such as the strap's low battery (#3066). Never asks for the
 * permission: without it the Devices screen still shows the level.
 */
export async function deviceAlert(title: string, body: string) {
  if (!(await alertPermission(false))) return;
  const notifications = await sdk();
  if (Platform.OS === 'android')
    await notifications.setNotificationChannelAsync('device-alerts', {
      name: 'Device battery',
      importance: notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  await notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: Platform.OS === 'android' ? { channelId: 'device-alerts' } : null,
  });
}
