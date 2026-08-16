import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trainingai.app',
  appName: 'TrainingAi',
  // Load from Railway — all server-side features (API routes, auth) stay on Railway.
  // UI changes deploy via Railway and appear in the APK without a rebuild.
  server: {
    url: 'https://trainingai-production.up.railway.app',
    cleartext: false,
  },
  android: {
    backgroundColor: '#09090b',
    // Capacitor's bridge logs EVERY plugin call and result to the console when
    // logging is on, and `logFromNative` does `console.dir(JSON.stringify(result.data))`
    // — so every SQLite result set is stringified on the main thread whether or
    // not DevTools is attached. A device profile put that one function at 16.4%
    // of main-thread time. The default is `debug`, which means "on in debug
    // builds", and the APK is built with assembleDebug.
    // This does NOT silence the Kotlin plugins: they log via android.util.Log,
    // not com.getcapacitor.Logger. Remote DevTools is a separate switch
    // (webContentsDebuggingEnabled) and is unaffected.
    loggingBehavior: 'none',
  },
  plugins: {
    SplashScreen: {
      // Remote WebView: hold the splash while the document loads, but never
      // hang on it — auto-hide caps the wait even if JS never runs (offline
      // cold start on a wiped cache). CapacitorNativeInit hides it earlier on mount.
      launchShowDuration: 5000,
      launchAutoHide: true,
      backgroundColor: '#09090b',
      showSpinner: false,
    },
  },
};

export default config;
