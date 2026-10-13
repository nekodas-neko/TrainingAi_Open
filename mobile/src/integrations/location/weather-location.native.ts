import { requireOptionalNativeModule } from 'expo';
import type { WeatherPlace } from '../../features/weather/data/models';
export async function weatherLocation(requestPermission = false): Promise<WeatherPlace | null> {
  if (!requireOptionalNativeModule('ExpoLocation')) {
    if (requestPermission)
      throw new Error(
        'Install the latest development build to use current location, or choose a city.',
      );
    return null;
  }
  const location = await import('expo-location');
  let permission = await location.getForegroundPermissionsAsync();
  if (!permission.granted && requestPermission && permission.canAskAgain) {
    permission = await location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    if (requestPermission)
      throw new Error('Allow location in phone settings, or choose a city below.');
    return null;
  }
  if (!(await location.hasServicesEnabledAsync())) return null;
  const saved = await location.getLastKnownPositionAsync({
    maxAge: 2 * 60_000,
    requiredAccuracy: 5000,
  });
  const position =
    saved ??
    (await new Promise<Awaited<ReturnType<typeof location.getCurrentPositionAsync>>>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Could not find your location. Choose a city or retry.')),
          8000,
        );
        location
          .getCurrentPositionAsync({
            accuracy: location.Accuracy.Low,
            mayShowUserSettingsDialog: requestPermission,
          })
          .then(resolve, reject)
          .finally(() => clearTimeout(timeout));
      },
    ));
  return {
    lat: Number(position.coords.latitude.toFixed(2)),
    lon: Number(position.coords.longitude.toFixed(2)),
    name: 'Current location',
  };
}
