import { requireOptionalNativeModule } from 'expo';
import { Alert, Platform } from 'react-native';
import {
  BACKGROUND_RATIONALE,
  type BackgroundRecorder,
} from '../../features/activities/data/background-recording';
import { BACKGROUND_LOCATION_TASK, setBackgroundFixSink } from './background-fixes';

// Android only. Asks for "Allow all the time" at the moment an activity starts, after saying why,
// then starts a location task with a foreground service. Anything short of a running service
// returns without one, and the screen-on watcher records as before.
const rationale = () =>
  new Promise<boolean>((resolve) =>
    Alert.alert(
      BACKGROUND_RATIONALE.title,
      BACKGROUND_RATIONALE.message,
      [
        { text: BACKGROUND_RATIONALE.skip, style: 'cancel', onPress: () => resolve(false) },
        { text: BACKGROUND_RATIONALE.allow, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );

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
          let always = await location.getBackgroundPermissionsAsync();
          if (!always.granted) {
            if (!always.canAskAgain || !(await rationale())) {
              return { result: 'denied' };
            }
            always = await location.requestBackgroundPermissionsAsync();
            if (!always.granted) {
              return { result: 'denied' };
            }
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
            return { result: 'skipped' };
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
