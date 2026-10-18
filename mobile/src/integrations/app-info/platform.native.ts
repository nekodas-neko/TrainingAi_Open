import { requireOptionalNativeModule } from 'expo';
import appConfig from '../../../app.json';

// Read from the installed APK (expo-application, already a dependency); falls back to the config
// value on builds made before the module existed.
const native = requireOptionalNativeModule<{ nativeApplicationVersion?: string | null }>(
  'ExpoApplication',
);
export const nativeAppVersion: string =
  native?.nativeApplicationVersion || appConfig.expo.version;
