import appConfig from '../../../app.json';

// The installed native build's version; the web and test runtimes fall back to the config value.
export const nativeAppVersion: string = appConfig.expo.version;
export const nativeBuildCode = '0';
/** The commit the JavaScript was built from; CI sets it, a local run shows 'dev'. */
export const appCodeSha: string = process.env.EXPO_PUBLIC_BUILD_SHA || 'dev';
