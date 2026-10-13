import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  find: vi.fn(),
  revoke: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    createNativeRefreshToken: mocks.create,
    findNativeRefreshTokenByHash: mocks.find,
    revokeNativeRefreshTokenFamily: mocks.revoke,
  }),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }));
import { POST } from '../route';
import { issueNativeSession } from '@/lib/auth/mobile/session';
import { bearerSession } from '@/lib/auth/bearer-session';
import { sessionTokenFrom } from '@/lib/auth/session-token';
const user = {
  id: 'user',
  email: 'user@example.invalid',
  isActive: true,
  isAdmin: false,
  createdAt: new Date(),
  timezone: 'Australia/Brisbane',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_SECRET', 'native-revocation-test-secret-long-enough');
  mocks.auth.mockResolvedValue({ user: { id: user.id } });
  mocks.create.mockResolvedValue({});
  mocks.find.mockResolvedValue({
    id: 'session',
    userId: user.id,
    familyId: 'family',
    expiresAt: new Date(Date.now() + 60000),
    revokedAt: null,
    rotatedAt: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('revocable native bearer sessions', () => {
  it('stores a hash and revokes only the authenticated token family', async () => {
    const issued = await issueNativeSession(user);
    expect(mocks.create.mock.calls[0][0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.create.mock.calls[0][0].tokenHash).not.toBe(issued.accessToken);
    const headers = new Headers({ authorization: `Bearer ${issued.accessToken}` });
    expect(await sessionTokenFrom(new Headers({ cookie: `authjs.session-token=${issued.accessToken}` }))).toBeNull();
    expect((await bearerSession(headers, async () => user))?.user.id).toBe(user.id);
    expect(
      (
        await POST(
          new NextRequest('https://example.com/api/auth/native-session/revoke', {
            method: 'POST',
            headers,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(user.id, 'family', 'sign_out');
    mocks.find.mockResolvedValue({
      userId: user.id,
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: new Date(),
    });
    expect(await bearerSession(headers, async () => user)).toBeNull();
  });
  it('fails closed for missing, expired, wrong-account and unavailable native session records', async () => {
    const issued = await issueNativeSession(user);
    const headers = new Headers({ authorization: `Bearer ${issued.accessToken}` });
    for (const stored of [
      null,
      { userId: 'other' },
      { userId: user.id, expiresAt: new Date(0) },
    ]) {
      mocks.find.mockResolvedValue(stored);
      expect(await bearerSession(headers, async () => user)).toBeNull();
    }
    mocks.find.mockRejectedValue(new Error('database offline'));
    await expect(bearerSession(headers, async () => user)).rejects.toThrow('temporarily unavailable');
    mocks.auth.mockResolvedValue(null);
    expect(
      (
        await POST(
          new NextRequest('https://example.com/api/auth/native-session/revoke', {
            method: 'POST',
            headers,
          }),
        )
      ).status,
    ).toBe(401);
  });
});
