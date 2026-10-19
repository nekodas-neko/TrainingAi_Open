import appConfig from '../../../app.json';

// The installed native build's version; the web and test runtimes fall back to the config value.
export const nativeAppVersion: string = appConfig.expo.version;
export const nativeBuildCode = '0';
