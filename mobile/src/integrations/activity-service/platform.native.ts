import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type {
  ActivityServiceStarter,
  BackgroundStarted,
} from '../../features/activities/data/background-recording';

type NativeActivityService = {
  start(title: string, body: string): Promise<'on' | 'failed' | 'skipped'>;
  stop(): Promise<void>;
};

// Android only (`modules/activity-service`). Absent on builds made before the module existed, where
// an indoor activity stays a screen-on recording as before.
const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeActivityService>('ActivityService')
    : null;

export const activityService: ActivityServiceStarter | undefined = native
  ? {
      async start({ notification }): Promise<BackgroundStarted> {
        const result = await native.start(notification.title, notification.body).catch(() => 'failed' as const);
        if (result === 'on') {
          return { result: 'on', stop: () => native.stop() };
        }
        // 'skipped' is Bluetooth permission missing: the strap card already says so.
        return { result: result === 'skipped' ? 'skipped' : 'failed' };
      },
    }
  : undefined;
