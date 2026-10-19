import { Platform } from 'react-native';
import { nativeAppVersion, nativeBuildCode } from '../../integrations/app-info/platform';
import { reportError, errorReporter } from './index.ts';

type RejectionTracker = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

let installed = false;

/**
 * Release builds only: development builds keep the LAN diagnostics and the red box instead. The
 * previous global handler still runs, so a fatal error still ends the app as before, up to 1.5 s
 * later.
 */
export function installErrorReporting() {
  if (installed || __DEV__ || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;
  installed = true;
  // Runs as App.tsx loads: reporting failing to start must never stop the app from starting.
  try {
    install(Platform.OS);
  } catch {}
}
function install(platform: 'android' | 'ios') {
  // Kept to the intake's character set, or every report would fail its schema and drop.
  errorReporter.enable({
    appVersion: nativeAppVersion.replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 32) || '0',
    buildCode: nativeBuildCode.replace(/[^0-9A-Za-z.]/g, '').slice(0, 16) || '0',
    platform,
  });
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error);
    if (!isFatal) return previous(error, isFatal);
    // A fatal error ends the app, which would take the queue with it: give the report a moment.
    void errorReporter.flushNow(1500).finally(() => previous(error, isFatal));
  });
  // React Native tracks unhandled rejections only in development; Hermes exposes the same hook.
  (
    globalThis as { HermesInternal?: RejectionTracker }
  ).HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => reportError(rejection),
    onHandled: () => {},
  });
}
