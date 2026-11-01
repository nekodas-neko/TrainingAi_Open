import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { BackgroundRecorder } from '../../features/activities/data/background-recording';
import { BACKGROUND_LOCATION_TASK, setBackgroundFixSink } from './background-fixes';

// Android only. Starts a location task with a foreground service whenever foreground location
// permission is held; the service needs no "Allow all the time" (expo-location skips that check
// when `foregroundService` is set). Without permission there is nothing to start ('skipped': the
// screen-on watcher reports it); if Android refuses the start it returns 'failed' so the walker is told.
export const backgroundRecorder: BackgroundRecorder | undefined =
  Platform.OS === 'android'
    ? {
        async start({ notification, fix }) {
          if (
            !requireOptionalNativeModule('ExpoLocation') ||
            !requireOptionalNativeModule('ExpoTaskManager')
          ) {
            return { result: 'skipped' };
          }
          const location = await import('expo-location');
          let foreground = await location.getForegroundPermissionsAsync();
          if (!foreground.granted && foreground.canAskAgain) {
            foreground = await location.requestForegroundPermissionsAsync();
          }
          // Not ours to report: the screen-on watcher says denied, approximate or off.
          if (
            !foreground.granted ||
            foreground.android?.accuracy === 'coarse' ||
            !(await location.hasServicesEnabledAsync())
          ) {
            return { result: 'skipped' };
          }
          try {
            // A service left by a crashed session would deliver to nobody.
            if (await location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
              await location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
            }
            setBackgroundFixSink(fix);
            await location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
              accuracy: location.Accuracy.BestForNavigation,
              distanceInterval: 0,
              timeInterval: 3000,
              foregroundService: {
                notificationTitle: notification.title,
                notificationBody: notification.body,
                // Swiping the app away ends the service: with no activity open, its fixes go nowhere.
                killServiceOnDestroy: true,
              },
            });
          } catch {
            setBackgroundFixSink(null);
            return { result: 'failed' };
          }
          return {
            result: 'on',
            async stop() {
              setBackgroundFixSink(null);
              if (await location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
                await location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
              }
            },
          };
        },
      }
    : undefined;
