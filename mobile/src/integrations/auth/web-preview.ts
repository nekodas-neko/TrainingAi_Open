/**
 * #3761. The browser preview's sign-in, for development exports only (`expo export --dev` with
 * EXPO_PUBLIC_WEB_PREVIEW_AUTH=1, which `scripts/web-screens.mjs` makes). `platform.web.ts` is the
 * one importer, and only behind `__DEV__`, so no Android or iOS bundle and no production web
 * export contains this file.
 *
 * It runs the app's real sign-in: the server's /mobile-signin pages in a popup, the PKCE exchange,
 * bearer tokens. The one hop a browser cannot make is the return to the app's callback scheme;
 * the script's local proxy turns that redirect into a page that posts the callback URL here.
 */
import type { AuthPlatform } from '../../features/account/session';
import { backendOrigin } from '../../features/account/api/client';
import { allowLocalHttpBackend } from '../../core/network/local-backend';

/** The message type the proxy's return page posts. Also what the release-bundle guard looks for. */
export const WEB_PREVIEW_AUTH_MESSAGE = 'trainingai-web-preview-auth';
const SIGN_IN_WAIT = 10 * 60 * 1000;

allowLocalHttpBackend();

function base64Url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function backend() {
  return backendOrigin(process.env.EXPO_PUBLIC_API_URL ?? '');
}
/** Only a local server: the preview never signs in anywhere else. */
export function webPreviewAuthAvailable() {
  try {
    const origin = new URL(backend());
    return (
      typeof window !== 'undefined' &&
      !!globalThis.crypto?.subtle &&
      ['localhost', '127.0.0.1'].includes(origin.hostname)
    );
  } catch {
    return false;
  }
}
let popup: Window | null = null;
export const webPreviewAuthPlatform: AuthPlatform = {
  // A development client: the server accepts its callback only outside production.
  client: 'android-dev',
  fetch: (input, init) => fetch(input, init),
  async revokeSession(origin, accessToken, refreshToken) {
    await fetch(`${origin}/api/auth/native-session/revoke`, {
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
    return window.localStorage.getItem(key);
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
  },
  async remove(key) {
    window.localStorage.removeItem(key);
  },
  async random() {
    return base64Url(crypto.getRandomValues(new Uint8Array(32)));
  },
  async device() {
    return { label: 'Browser preview' };
  },
  async challenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  },
  open(url) {
    const origin = backend();
    return new Promise((resolve) => {
      popup = window.open(url, 'trainingai-sign-in', 'popup,width=420,height=760');
      if (!popup) {
        resolve({ type: 'dismiss' });
        return;
      }
      const opened = popup;
      const finish = (result: { type: string; url?: string }) => {
        window.removeEventListener('message', onMessage);
        clearInterval(watch);
        clearTimeout(limit);
        if (!opened.closed) opened.close();
        if (popup === opened) popup = null;
        resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; url?: unknown } | null;
        if (
          event.origin !== origin ||
          event.source !== opened ||
          data?.type !== WEB_PREVIEW_AUTH_MESSAGE ||
          typeof data.url !== 'string'
        ) {
          return;
        }
        finish({ type: 'success', url: data.url });
      };
      window.addEventListener('message', onMessage);
      const watch = setInterval(() => {
        if (opened.closed) finish({ type: 'cancel' });
      }, 500);
      const limit = setTimeout(() => finish({ type: 'dismiss' }), SIGN_IN_WAIT);
    });
  },
  dismiss() {
    if (popup && !popup.closed) popup.close();
    popup = null;
  },
};
