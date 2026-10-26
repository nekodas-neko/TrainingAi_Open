import { fetch as nativeFetch } from 'expo/fetch';
import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { MOBILE_CALLBACKS } from '../../features/account/session';
import type { AuthPlatform, MobileClient } from '../../features/account/session';
import { homeWidgets } from '../widgets/platform';
import { openLocalStorage } from '../../core/storage/open';

const applicationId =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<{ applicationId: string }>('ExpoApplication')?.applicationId
    : null;
// The application ID decides which sign-in callback the server sends this build back to.
const ANDROID_CLIENTS: Record<string, MobileClient> = {
  'com.trainingai.app': 'android',
  'com.trainingai.app.dev': 'android-dev',
  'com.trainingai.app.preview': 'android-preview',
};
const client: MobileClient =
  Platform.OS === 'ios' ? 'ios' : (ANDROID_CLIENTS[applicationId ?? ''] ?? 'android');
const callback = MOBILE_CALLBACKS[client];
export function nativeAuthAvailable() {
  return (
    !isRunningInExpoGo() &&
    (Platform.OS !== 'android' ||
      Object.hasOwn(ANDROID_CLIENTS, applicationId ?? '')) &&
    ['ExpoSecureStore', 'ExpoCrypto', 'ExpoWebBrowser'].every(
      (name) => !!requireOptionalNativeModule(name),
    )
  );
}
export function nativeAppleAuthAvailable() {
  return (
    Platform.OS === 'ios' &&
    !isRunningInExpoGo() &&
    !!requireOptionalNativeModule('ExpoAppleAuthentication')
  );
}
async function store() {
  return import('expo-secure-store');
}
export const authPlatform: AuthPlatform = {
  client,
  fetch: nativeFetch,
  async revokeSession(origin, accessToken, refreshToken) {
    // The refresh token outlives the one-day access token, so it is what names the sign-in to end.
    await nativeFetch(`${origin}/api/auth/native-session/revoke`, {
      method: 'POST',
      credentials: 'omit',
      headers: refreshToken
        ? { 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${accessToken}` },
      ...(refreshToken ? { body: JSON.stringify({ refreshToken }) } : {}),
      signal: AbortSignal.timeout(5000),
    });
  },
  async get(key) {
    return (await store()).getItemAsync(key);
  },
  async set(key, value) {
    const secureStore = await store();
    await secureStore.setItemAsync(key, value, {
      ...(Platform.OS === 'ios'
        ? { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
        : {}),
    });
  },
  async remove(key) {
    await (await store()).deleteItemAsync(key);
  },
  async random() {
    const crypto = await import('expo-crypto');
    const bytes = await crypto.getRandomBytesAsync(32);
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },
  async challenge(verifier) {
    const crypto = await import('expo-crypto');
    const digest = await crypto.digestStringAsync(
      crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: crypto.CryptoEncoding.BASE64 },
    );
    return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async appleSignIn(nonce, state) {
    if (Platform.OS !== 'ios') throw new Error('Apple sign-in is available on iOS.');
    const apple = await import('expo-apple-authentication');
    const credential = await apple.signInAsync({
      nonce,
      state,
      requestedScopes: [
        apple.AppleAuthenticationScope.EMAIL,
        apple.AppleAuthenticationScope.FULL_NAME,
      ],
    });
    if (!credential.identityToken) {
      throw new Error('Apple did not provide an identity token.');
    }
    const fullName = credential.fullName
      ? apple.formatFullName(credential.fullName).trim().slice(0, 100)
      : '';
    return {
      identityToken: credential.identityToken,
      state: credential.state,
      ...(fullName ? { name: fullName } : {}),
    };
  },
  async open(url) {
    return (await import('expo-web-browser')).openAuthSessionAsync(url, callback);
  },
  clearAccountData() {
    homeWidgets?.clearSnapshot();
  },
  async wipeAccountData(origin, userId) {
    const storage = await openLocalStorage();
    if (userId === null) await storage.clearAllAccounts();
    else await storage.clearAccount(origin, userId);
    homeWidgets?.clearSnapshot();
  },
  dismiss() {
    const browser = requireOptionalNativeModule<{ dismissAuthSession(): void }>(
      'ExpoWebBrowser',
    );
    browser?.dismissAuthSession();
  },
};
