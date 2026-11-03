import { requireOptionalNativeModule } from 'expo';
import appConfig from '../../../app.json';

// Read from the installed APK (expo-application, already a dependency); falls back to the config
// value on builds made before the module existed.
const native = requireOptionalNativeModule<{
  nativeApplicationVersion?: string | null;
  nativeBuildVersion?: string | null;
}>('ExpoApplication');
export const nativeAppVersion: string =
  native?.nativeApplicationVersion || appConfig.expo.version;
/** The Android versionCode or iOS build number; '0' when the module is missing. */
export const nativeBuildCode: string = native?.nativeBuildVersion || '0';
/** The commit the JavaScript was built from; CI sets it, a local run shows 'dev'. */
export const appCodeSha: string = process.env.EXPO_PUBLIC_BUILD_SHA || 'dev';
