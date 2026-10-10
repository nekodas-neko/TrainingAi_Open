import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';
import { AUTH_CALLBACK } from '../../features/account/session';
import type { AuthPlatform } from '../../features/account/session';

export function nativeAuthAvailable() {
  return !isRunningInExpoGo() && ['ExpoSecureStore', 'ExpoCrypto', 'ExpoWebBrowser'].every(name => !!requireOptionalNativeModule(name));
}
export function nativeAppleAuthAvailable() { return !isRunningInExpoGo() && !!requireOptionalNativeModule('ExpoAppleAuthentication'); }
async function store() { return import('expo-secure-store'); }
export const authPlatform: AuthPlatform = {
  async get(key) { return (await store()).getItemAsync(key); },
  async set(key, value) {
    const secureStore = await store();
    await secureStore.setItemAsync(key, value, { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async remove(key) { await (await store()).deleteItemAsync(key); },
  async random() {
    const crypto = await import('expo-crypto');
    const bytes = await crypto.getRandomBytesAsync(32);
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async challenge(verifier) {
    const crypto = await import('expo-crypto');
    const digest = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: crypto.CryptoEncoding.BASE64 });
    return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async appleSignIn(nonce, state) {
    const apple = await import('expo-apple-authentication');
    const credential = await apple.signInAsync({ nonce, state, requestedScopes: [apple.AppleAuthenticationScope.EMAIL, apple.AppleAuthenticationScope.FULL_NAME] });
    if (!credential.identityToken) { throw new Error('Apple did not provide an identity token.'); }
    const fullName = credential.fullName ? apple.formatFullName(credential.fullName).trim().slice(0, 100) : '';
    return { identityToken: credential.identityToken, state: credential.state, ...(fullName ? { name: fullName } : {}) };
  },
  async open(url) { return (await import('expo-web-browser')).openAuthSessionAsync(url, AUTH_CALLBACK); },
  dismiss() {
    const browser = requireOptionalNativeModule<{ dismissAuthSession(): void }>('ExpoWebBrowser');
    browser?.dismissAuthSession();
  },
};
