import { requireOptionalNativeModule } from 'expo';
import type { LocationSource } from '../../features/activities/data/route-recording';
import { backgroundRecorder } from './background-recorder';

// The screen-on route watcher for TrainingAi Preview (#2845 phase 1), plus the foreground-service
// recorder that keeps recording with the screen locked (#2846). The recorder is used when the
// walker allows "all the time" location; this watcher is the fallback and records as it always did.
// Every fix is passed on: the current app's 5 m filter is applied by the recorder (`keepsFix`),
// so a walker who has stopped still shows a live signal.
export const routeLocation: LocationSource = {
  background: backgroundRecorder,
  async watch(handlers) {
    if (!requireOptionalNativeModule('ExpoLocation')) {
      handlers.problem('unavailable');
      return () => {};
    }
    const location = await import('expo-location');
    let permission = await location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) {
      handlers.problem('denied');
      return () => {};
    }
    // Approximate location only gives fixes a kilometre or two apart, which would read as a route.
    if (permission.android?.accuracy === 'coarse' || permission.ios?.accuracy === 'reduced') {
      handlers.problem('approximate');
      return () => {};
    }
    if (!(await location.hasServicesEnabledAsync())) {
      handlers.problem('disabled');
      return () => {};
    }
    const subscription = await location.watchPositionAsync(
      {
        accuracy: location.Accuracy.BestForNavigation,
        distanceInterval: 0,
        timeInterval: 3000,
        mayShowUserSettingsDialog: true,
      },
      (fix) =>
        handlers.fix({
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          ...(fix.coords.altitude != null ? { ele: fix.coords.altitude } : {}),
          t: fix.timestamp,
        }),
      () => {
        void location.hasServicesEnabledAsync().then(
          (enabled) => handlers.problem(enabled ? 'failed' : 'disabled'),
          () => handlers.problem('failed'),
        );
      },
    );
    return () => subscription.remove();
  },
};
