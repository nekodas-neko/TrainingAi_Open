import { SignJWT, jwtVerify } from 'jose';
import { PKCE_CHALLENGE_RE } from './pkce';

export const NATIVE_TRANSACTION_COOKIE = 'ta_mobile_ios';
export const NATIVE_CONSENT_COOKIE = 'ta_mobile_consent';
export const NATIVE_TRANSACTION_MAX_AGE = 10 * 60;
export const NATIVE_STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export const NATIVE_CALLBACKS = {
  ios: 'com.fitnessai.training:/auth/callback',
  android: 'com.trainingai.app:/auth/callback',
  'android-dev': 'com.trainingai.app.dev:/auth/callback',
  // The side-by-side build the owner runs next to the real app (#2878). It talks to production,
  // so unlike `android-dev` it is accepted there.
  'android-preview': 'com.trainingai.app.preview:/auth/callback',
} as const;
export type NativeClient = keyof typeof NATIVE_CALLBACKS;
export type NativeTransaction = { client: NativeClient; challenge: string; state: string };
type CookieStore = { get(name: string): { value: string } | undefined };
export function isNativeClient(value: unknown): value is NativeClient {
  return (
    typeof value === 'string' &&
    Object.hasOwn(NATIVE_CALLBACKS, value) &&
    (value !== 'android-dev' ||
      process.env.NODE_ENV !== 'production' ||
      process.env.NATIVE_AUTH_ALLOW_ANDROID_DEV === '1')
  );
}
function signingKey() {
  if (!process.env.AUTH_SECRET) throw new Error('Mobile authentication is not configured.');
  return new TextEncoder().encode(process.env.AUTH_SECRET);
}
export async function signNativeTransaction(transaction: NativeTransaction) {
  return new SignJWT(transaction)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('trainingai-mobile-signin')
    .setAudience(transaction.client)
    .setIssuedAt()
    .setExpirationTime(`${NATIVE_TRANSACTION_MAX_AGE}s`)
    .sign(signingKey());
}
export async function signNativeConsent(transaction: NativeTransaction, userId: string) {
  return new SignJWT({ ...transaction, userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('trainingai-mobile-consent')
    .setAudience(transaction.client)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(signingKey());
}
export async function hasNativeConsent(
  store: CookieStore,
  transaction: NativeTransaction,
  userId: string,
) {
  const value = store.get(NATIVE_CONSENT_COOKIE)?.value;
  if (!value) return false;
  try {
    const { payload } = await jwtVerify(value, signingKey(), {
      algorithms: ['HS256'],
      issuer: 'trainingai-mobile-consent',
      audience: transaction.client,
      maxTokenAge: 300,
      requiredClaims: ['exp', 'iat'],
    });
    return (
      payload.userId === userId &&
      payload.state === transaction.state &&
      payload.challenge === transaction.challenge
    );
  } catch {
    return false;
  }
}
export async function readNativeTransaction(
  store: CookieStore,
): Promise<NativeTransaction | null> {
  const value = store.get(NATIVE_TRANSACTION_COOKIE)?.value;
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, signingKey(), {
      algorithms: ['HS256'],
      issuer: 'trainingai-mobile-signin',
      audience: Object.keys(NATIVE_CALLBACKS),
      maxTokenAge: NATIVE_TRANSACTION_MAX_AGE,
      requiredClaims: ['exp', 'iat'],
    });
    const client = payload.client ?? 'ios';
    if (
      !isNativeClient(client) ||
      payload.aud !== client ||
      typeof payload.challenge !== 'string' ||
      !PKCE_CHALLENGE_RE.test(payload.challenge) ||
      typeof payload.state !== 'string' ||
      !NATIVE_STATE_RE.test(payload.state)
    )
      return null;
    return { client, challenge: payload.challenge, state: payload.state };
  } catch {
    return null;
  }
}
export function nativeSignInPath(transaction: NativeTransaction) {
  return transaction.client === 'ios' ? '/mobile-signin/ios' : '/mobile-signin/native';
}
export function nativeBridgePath(transaction: NativeTransaction) {
  return `/auth-mobile-bridge?${new URLSearchParams({ client: transaction.client, challenge: transaction.challenge, state: transaction.state })}`;
}
export function nativeReturnUrl(
  transaction: NativeTransaction,
  result: { token: string } | { error: 'account_pending' | 'authentication_failed' },
) {
  return `${NATIVE_CALLBACKS[transaction.client]}?${new URLSearchParams({ state: transaction.state, ...result })}`;
}
export async function nativeLoginContinuation(store: CookieStore) {
  const transaction = await readNativeTransaction(store);
  const callback =
    store.get('__Secure-authjs.callback-url') ?? store.get('authjs.callback-url');
  if (!transaction || !callback) return null;
  try {
    const url = new URL(callback.value);
    return `${url.pathname}${url.search}` === nativeBridgePath(transaction) && !url.hash
      ? transaction
      : null;
  } catch {
    return null;
  }
}
