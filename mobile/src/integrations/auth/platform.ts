import type { AuthPlatform } from '../../features/account/session';
export function nativeAppleAuthAvailable() {
  return false;
}
export function nativeAuthAvailable() {
  return false;
}
const unsupported = async (): Promise<never> => {
  throw new Error('Sign-in requires the native mobile app.');
};
export const authPlatform: AuthPlatform = {
  get: unsupported,
  set: unsupported,
  remove: unsupported,
  random: unsupported,
  challenge: unsupported,
  open: unsupported,
  dismiss() {},
};
