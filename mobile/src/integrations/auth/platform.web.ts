import type { AuthPlatform } from '../../features/account/session';

/**
 * The web build. A development export made for the browser preview (#3761) signs in to a local
 * server through `web-preview.ts`; every other web build has no sign-in. `__DEV__` is false in a
 * production export, so Metro folds this branch away and `web-preview.ts` is not bundled.
 */
const preview =
  __DEV__ && process.env.EXPO_PUBLIC_WEB_PREVIEW_AUTH === '1'
    ? (require('./web-preview') as typeof import('./web-preview'))
    : null;

export function nativeAppleAuthAvailable() {
  return false;
}
export function nativeAuthAvailable() {
  return preview?.webPreviewAuthAvailable() ?? false;
}
const unsupported = async (): Promise<never> => {
  throw new Error('Sign-in requires the native mobile app.');
};
const stub: AuthPlatform = {
  get: unsupported,
  set: unsupported,
  remove: unsupported,
  random: unsupported,
  challenge: unsupported,
  open: unsupported,
  dismiss() {},
};
export const authPlatform: AuthPlatform = preview?.webPreviewAuthPlatform ?? stub;
