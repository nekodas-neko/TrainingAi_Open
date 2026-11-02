// #3280. The device label and install id the app sends with the code exchange reach the token row,
// and a malformed one is refused before the one-time code is spent.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  consume: vi.fn(),
}));
const user = { id: 'user', email: 'user@example.invalid', isActive: true, isAdmin: false, createdAt: new Date(), timezone: 'Australia/Brisbane' };
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ createNativeRefreshToken: mocks.create, getUserById: async () => user }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }));
vi.mock('@/lib/auth/mobile/tokens', () => ({ consumeMobileAuthToken: mocks.consume }));
vi.mock('@/lib/auth/mobile/pkce', () => ({ verifyPkce: () => true }));
vi.mock('@/lib/auth/session-token', () => ({
  sessionTokenFrom: async () => ({ userId: 'user', exp: Math.floor(Date.now() / 1000) + 600, isActive: true }),
}));
vi.mock('@/lib/auth/is-active-refresh', () => ({ refreshIsActiveClaim: async () => {} }));

import { POST } from './route';

const exchange = (extra: object) =>
  POST(
    new NextRequest('https://example.com/api/auth/exchange-mobile-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 't', verifier: 'v', responseType: 'token', ...extra }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_SECRET', 'device-label-test-secret-long-enough-for-hs');
  mocks.consume.mockReturnValue({ sessionCookieValue: 'c', challenge: 'x' });
  mocks.create.mockResolvedValue({ id: '5e551011-0000-4000-8000-000000003280', expiresAt: new Date(Date.now() + 60000) });
});

describe('exchange-mobile-token device info', () => {
  it('stores the label and install id the app sent', async () => {
    const res = await exchange({ deviceLabel: ' Galaxy S25 Ultra ', deviceId: 'abcDEF_123-xyz45' });
    expect(res.status).toBe(200);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ deviceLabel: 'Galaxy S25 Ultra', deviceId: 'abcDEF_123-xyz45' });
  });
  it('keeps "Native app" and no id for an app that sends neither', async () => {
    expect((await exchange({})).status).toBe(200);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ deviceLabel: 'Native app', deviceId: null });
  });
  it('refuses a label or id the table would reject, without consuming the code', async () => {
    for (const bad of [
      { deviceLabel: '' },
      { deviceLabel: '   ' },
      { deviceLabel: 'x'.repeat(81) },
      { deviceLabel: 'line\nbreak' },
      { deviceLabel: 42 },
      { deviceLabel: null },
      { deviceId: 'short' },
      { deviceId: 'has space in it!' },
      { deviceId: 'a'.repeat(65) },
    ]) {
      expect((await exchange(bad)).status).toBe(400);
    }
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
