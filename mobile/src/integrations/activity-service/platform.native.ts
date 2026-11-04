import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { ActivityServiceStarter } from '../../features/activities/data/background-recording';
import {
  createActivityServiceHost,
  type ActivityServiceHost,
  type NativeActivityService,
} from './shared-service';

// Android only (`modules/activity-service`). Absent on builds made before the module existed, where
// an indoor activity stays a screen-on recording as before.
const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NativeActivityService>('ActivityService')
    : null;

/** The one connected-device service, shared by an activity and a gym workout (#3627). */
export const activityServiceHost: ActivityServiceHost | undefined = native
  ? createActivityServiceHost({
      // 'skipped' is Bluetooth permission missing: the strap card already says so.
      start: (...args) => native.start(...args).catch(() => 'failed' as const),
      show: (...args) => native.show(...args),
      clear: () => native.clear(),
      stop: () => native.stop(),
    })
  : undefined;

export const activityService: ActivityServiceStarter | undefined = activityServiceHost?.starter('activity');
export const workoutStrapService: ActivityServiceStarter | undefined = activityServiceHost?.starter('workout');
