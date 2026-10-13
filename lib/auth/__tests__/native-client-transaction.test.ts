import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { GET } from '@/app/mobile-signin/begin/route';
import {
  NATIVE_CALLBACKS,
  NATIVE_TRANSACTION_COOKIE,
  nativeBridgePath,
  nativeReturnUrl,
  readNativeTransaction,
  signNativeTransaction,
  nativeLoginContinuation,
} from '../mobile/native-transaction';
import { readIosTransaction } from '../mobile/ios-transaction';

const challenge = 'C'.repeat(43);
const state = 'S'.repeat(43);
const secret = 'native-transaction-test-key-1234567890';
const cookie = (token: string, callback?: string) => ({
  get: (name: string) =>
    name === NATIVE_TRANSACTION_COOKIE
      ? { value: token }
      : name === 'authjs.callback-url' && callback
        ? { value: callback }
        : undefined,
});
beforeEach(() => vi.stubEnv('AUTH_SECRET', secret));
afterEach(() => vi.unstubAllEnvs());

describe('native client transactions', () => {
  for (const client of ['ios', 'android', 'android-dev'] as const) {
    it(`binds ${client} to its registered callback and PKCE transaction`, async () => {
      const transaction = { client, challenge, state };
      const response = await GET(
        new NextRequest(
          `https://example.com/mobile-signin/begin?${new URLSearchParams(transaction)}`,
        ),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        client === 'ios' ? '/mobile-signin/ios' : '/mobile-signin/native',
      );
      const token = response.cookies.get(NATIVE_TRANSACTION_COOKIE)!;
      expect(token.httpOnly).toBe(true);
      expect(token.sameSite).toBe('lax');
      expect(await readNativeTransaction(cookie(token.value))).toEqual(transaction);
      expect(nativeReturnUrl(transaction, { token: 'bridge-code' })).toBe(
        `${NATIVE_CALLBACKS[client]}?state=${state}&token=bridge-code`,
      );
      expect(
        await nativeLoginContinuation(
          cookie(token.value, `https://example.com${nativeBridgePath(transaction)}`),
        ),
      ).toEqual(transaction);
      expect(
        await nativeLoginContinuation(
          cookie(
            token.value,
            `https://example.com${nativeBridgePath({ ...transaction, state: challenge })}`,
          ),
        ),
      ).toBeNull();
    });
  }
  it('reads an existing iPhone transaction with no client claim', async () => {
    const token = await new SignJWT({ challenge, state })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('trainingai-mobile-signin')
      .setAudience('ios')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(secret));
    expect(await readIosTransaction(cookie(token))).toEqual({ challenge, state });
  });
  it('rejects a signed client/audience mismatch and expires old attempts', async () => {
    for (const expiration of ['10m', '-1s']) {
      const token = await new SignJWT({ client: 'android-dev', challenge, state })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('trainingai-mobile-signin')
        .setAudience('android')
        .setIssuedAt()
        .setExpirationTime(expiration)
        .sign(new TextEncoder().encode(secret));
      expect(await readNativeTransaction(cookie(token))).toBeNull();
    }
    const token = await signNativeTransaction({ client: 'android', challenge, state });
    expect(await readNativeTransaction(cookie(token.slice(0, -5) + 'xxxxx'))).toBeNull();
    expect(await readIosTransaction(cookie(token))).toBeNull();
  });
  it('rejects unknown clients, malformed states and duplicate parameters before setting cookies', async () => {
    for (const query of [
      `client=other&state=${state}`,
      `client=android&state=nope`,
      `client=android&client=ios&state=${state}`,
    ]) {
      const response = await GET(
        new NextRequest(
          `https://example.com/mobile-signin/begin?challenge=${challenge}&${query}`,
        ),
      );
      expect(response.status).toBe(400);
      expect(response.cookies.get(NATIVE_TRANSACTION_COOKIE)).toBeUndefined();
    }
  });
});
