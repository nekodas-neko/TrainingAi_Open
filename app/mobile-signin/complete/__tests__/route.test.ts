import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), cookies: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import { GET } from '../route';
import {
  signNativeConsent,
  signNativeTransaction,
  NATIVE_CONSENT_COOKIE,
  NATIVE_TRANSACTION_COOKIE,
} from '@/lib/auth/mobile/native-transaction';
import { MOBILE_CHALLENGE_COOKIE } from '@/lib/auth/mobile/challenge-cookie';
const transaction = {
  client: 'android' as const,
  state: 'S'.repeat(43),
  challenge: 'C'.repeat(43),
};
const values = new Map<string, string>();
beforeEach(async () => {
  vi.stubEnv('AUTH_SECRET', 'native-consent-test-secret-long-enough');
  values.clear();
  values.set(NATIVE_TRANSACTION_COOKIE, await signNativeTransaction(transaction));
  values.set(MOBILE_CHALLENGE_COOKIE, transaction.challenge);
  values.set('authjs.session-token', 'synthetic-cookie');
  values.set('__Secure-authjs.session-token', 'synthetic-cookie');
  mocks.cookies.mockResolvedValue({
    get: (name: string) => (values.has(name) ? { value: values.get(name) } : undefined),
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
  });
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
});
afterEach(() => vi.unstubAllEnvs());
it('requires account-bound consent before returning a bridge code', async () => {
  expect((await GET()).status).toBe(401);
  values.set(NATIVE_CONSENT_COOKIE, await signNativeConsent(transaction, 'other'));
  expect((await GET()).status).toBe(401);
  values.set(
    NATIVE_CONSENT_COOKIE,
    await signNativeConsent({ ...transaction, state: 'X'.repeat(43) }, 'user'),
  );
  expect((await GET()).status).toBe(401);
});
it('returns to the approved client and clears all transient bridge cookies', async () => {
  values.set(NATIVE_CONSENT_COOKIE, await signNativeConsent(transaction, 'user'));
  const response = await GET();
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toMatch(
    /^com.trainingai.app:\/auth\/callback\?state=/,
  );
  expect(response.headers.get('location')).toContain('token=');
  for (const name of [
    NATIVE_TRANSACTION_COOKIE,
    NATIVE_CONSENT_COOKIE,
    MOBILE_CHALLENGE_COOKIE,
  ])
    expect(response.cookies.get(name)?.value).toBe('');
});

// #3797 item 2: the browser's session cookie is cleared with the name, path and flags Auth.js set
// it with, chunks included, so the phone's browser is not left signed in.
it('clears the web session cookie on the complete response', async () => {
  values.set(NATIVE_CONSENT_COOKIE, await signNativeConsent(transaction, 'user'));
  values.set('authjs.session-token.0', 'chunk-0');
  values.set('authjs.session-token.1', 'chunk-1');
  const response = await GET();
  expect(response.status).toBe(307);
  const setCookie = response.headers.getSetCookie();
  for (const name of [
    'authjs.session-token',
    'authjs.session-token.0',
    'authjs.session-token.1',
    '__Secure-authjs.session-token',
  ]) {
    const line = setCookie.find((c) => c.startsWith(`${name}=;`));
    expect(line, name).toBeDefined();
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=0/);
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).not.toMatch(/Domain=/i);
  }
  expect(setCookie.find((c) => c.startsWith('__Secure-authjs.session-token=;'))).toMatch(/Secure/);
});
it('leaves the session cookie alone when it refuses', async () => {
  const response = await GET();
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie().some((c) => c.includes('session-token'))).toBe(false);
});
