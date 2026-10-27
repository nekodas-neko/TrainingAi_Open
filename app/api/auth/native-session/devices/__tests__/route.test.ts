// #3280. The device list and the device revoke: session check, rate limit, Zod, the family id scoped
// to the caller, and this device refused.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rate: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
  family: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    listNativeDevices: mocks.list,
    revokeNativeRefreshTokenFamily: mocks.revoke,
  }),
}));
vi.mock('@/lib/auth/mobile/session', () => ({ presentedNativeFamily: mocks.family }));

import { GET } from '../route';
import { POST } from '../revoke/route';

const FAMILY_THIS = '11111111-1111-4111-8111-111111111111';
const FAMILY_OTHER = '22222222-2222-4222-8222-222222222222';
const get = () => new NextRequest('https://example.com/api/auth/native-session/devices');
const post = (body: unknown) =>
  new NextRequest('https://example.com/api/auth/native-session/devices/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
  mocks.rate.mockReturnValue(true);
  mocks.family.mockResolvedValue(FAMILY_THIS);
  mocks.revoke.mockResolvedValue(1);
  mocks.list.mockResolvedValue([
    {
      familyId: FAMILY_THIS,
      deviceLabel: 'Galaxy S25 Ultra',
      signedInAt: new Date('2026-10-06T01:00:00Z'),
      lastUsedAt: new Date('2026-10-26T01:00:00Z'),
    },
    {
      familyId: FAMILY_OTHER,
      deviceLabel: 'Pixel 8',
      signedInAt: new Date('2026-10-01T01:00:00Z'),
      lastUsedAt: new Date('2026-10-24T01:00:00Z'),
    },
  ]);
});

describe('GET native-session/devices', () => {
  it('lists the caller’s devices, marks this one, and never caches', async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.list).toHaveBeenCalledWith('user');
    expect(mocks.family).toHaveBeenCalledWith(expect.any(Headers), 'user');
    expect(await res.json()).toEqual({
      devices: [
        { id: FAMILY_THIS, label: 'Galaxy S25 Ultra', signedInAt: '2026-10-06T01:00:00.000Z', lastUsedAt: '2026-10-26T01:00:00.000Z', current: true },
        { id: FAMILY_OTHER, label: 'Pixel 8', signedInAt: '2026-10-01T01:00:00.000Z', lastUsedAt: '2026-10-24T01:00:00.000Z', current: false },
      ],
    });
  });
  it('marks no device current for a cookie session', async () => {
    mocks.family.mockResolvedValue(null);
    const body = await (await GET(get())).json();
    expect(body.devices.every((d: { current: boolean }) => !d.current)).toBe(true);
  });
  it('is 401 without a session and 429 over the limit, reading nothing', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: 'user' } });
    mocks.rate.mockReturnValue(false);
    expect((await GET(get())).status).toBe(429);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('is 503 when the read fails, without the error text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list.mockRejectedValue(new Error('select … token_hash'));
    const res = await GET(get());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('token_hash');
  });
});

describe('POST native-session/devices/revoke', () => {
  it('revokes another device’s family for the caller with reason user', async () => {
    const res = await POST(post({ id: FAMILY_OTHER }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.revoke).toHaveBeenCalledWith('user', FAMILY_OTHER, 'user');
  });
  it('refuses this device, which sign-out covers', async () => {
    expect((await POST(post({ id: FAMILY_THIS }))).status).toBe(409);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('is 404 when the family is not the caller’s or does not exist', async () => {
    mocks.revoke.mockResolvedValue(0);
    expect((await POST(post({ id: FAMILY_OTHER }))).status).toBe(404);
  });
  it('is 400 for a body that is not exactly a uuid id', async () => {
    for (const body of [{}, { id: 'family' }, { id: FAMILY_OTHER, userId: 'victim' }, { id: [FAMILY_OTHER] }, '{not json']) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('is 401 without a session and 429 over the limit, revoking nothing', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(post({ id: FAMILY_OTHER }))).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: 'user' } });
    mocks.rate.mockReturnValue(false);
    expect((await POST(post({ id: FAMILY_OTHER }))).status).toBe(429);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it('is 503 when the revoke fails, so the screen does not report a sign-out that did not happen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.revoke.mockRejectedValue(new Error('db down'));
    expect((await POST(post({ id: FAMILY_OTHER }))).status).toBe(503);
  });
});
