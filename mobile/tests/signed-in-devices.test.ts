import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApiClient } from '../src/features/account/api/client.ts';
import { AccountSession } from '../src/features/account/session.ts';
import type { AccountConnection, AuthPlatform } from '../src/features/account/session.ts';
import {
  devicesMessage,
  lastUsedLabel,
  orderDevices,
  readSignedInDevices,
  revokeSignedInDevice,
  signedInLabel,
} from '../src/features/devices/data/signed-in-devices.ts';

const ID_THIS = '11111111-1111-4111-8111-111111111111';
const ID_OTHER = '22222222-2222-4222-8222-222222222222';
function connection(answers: Record<string, unknown>, calls: string[] = []): AccountConnection {
  const answer = async (key: string) => {
    calls.push(key);
    const value = answers[key];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    origin: 'https://example.com',
    userId: 'u1',
    timezone: null,
    get: (path) => answer(`GET ${path}`),
    post: (path, body) => answer(`POST ${path} ${JSON.stringify(body)}`),
  };
}

test('reads the device list and rejects a reply that is not one', async () => {
  const devices = [
    { id: ID_THIS, label: 'Galaxy S25 Ultra', signedInAt: '2026-10-06T01:00:00.000Z', lastUsedAt: '2026-10-26T01:00:00.000Z', current: true },
    { id: ID_OTHER, label: 'Pixel 8', signedInAt: '2026-10-01T01:00:00.000Z', lastUsedAt: '2026-10-24T01:00:00.000Z', current: false },
  ];
  assert.deepEqual(await readSignedInDevices(connection({ 'GET /api/auth/native-session/devices': { devices } })), devices);
  await assert.rejects(readSignedInDevices(connection({ 'GET /api/auth/native-session/devices': { devices: [{ id: 'x' }] } })));
  await assert.rejects(readSignedInDevices(connection({ 'GET /api/auth/native-session/devices': null })));
});

test('revoke posts only the family id', async () => {
  const calls: string[] = [];
  await revokeSignedInDevice(connection({ [`POST /api/auth/native-session/devices/revoke {"id":"${ID_OTHER}"}`]: { ok: true } }, calls), ID_OTHER);
  assert.deepEqual(calls, [`POST /api/auth/native-session/devices/revoke {"id":"${ID_OTHER}"}`]);
});

test('failures read as plain sentences and never echo server text', () => {
  assert.match(devicesMessage(new ApiError(409)), /Sign out in Account/);
  assert.match(devicesMessage(new ApiError(404)), /already signed out/);
  assert.match(devicesMessage(new ApiError(500)), /try again/i);
  assert.match(devicesMessage(new Error('network down')), /could not be reached/);
});

test('dates are calendar days in the user\'s timezone', () => {
  const tz = 'Australia/Brisbane';
  const now = new Date('2026-10-26T02:00:00Z');
  assert.equal(signedInLabel('2026-10-06T01:00:00.000Z', tz), 'Signed in 6 Oct');
  // 14:30 on the 5th in UTC is already the 6th in Brisbane.
  assert.equal(signedInLabel('2026-10-05T14:30:00.000Z', tz), 'Signed in 6 Oct');
  assert.equal(lastUsedLabel('2026-10-26T01:55:00.000Z', now, tz), 'Last used just now');
  assert.equal(lastUsedLabel('2026-10-26T00:00:00.000Z', now, tz), 'Last used today');
  assert.equal(lastUsedLabel('2026-10-25T05:00:00.000Z', now, tz), 'Last used yesterday');
  assert.equal(lastUsedLabel('2026-10-24T05:00:00.000Z', now, tz), 'Last used 2 days ago');
  assert.equal(lastUsedLabel('2026-10-05T05:00:00.000Z', now, tz), 'Last used 3 weeks ago');
  assert.equal(lastUsedLabel('2026-07-05T05:00:00.000Z', now, tz), 'Last used 5 July');
  assert.equal(lastUsedLabel('not a date', now, tz), 'Last used unknown');
});

test('the code exchange sends the device label and id only when there are some', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ ok: true, tokenType: 'Bearer', accessToken: 'a', expiresAt: 4_000_000_000 }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const api = createApiClient('https://example.com', async () => null, fetcher as typeof fetch);
  await api.exchange('t', 'v');
  await api.exchange('t', 'v', { label: 'Samsung SM-S938B', id: 'abcDEF_123-xyz45' });
  assert.deepEqual(bodies[0], { token: 't', verifier: 'v', responseType: 'token' });
  assert.deepEqual(bodies[1], {
    token: 't',
    verifier: 'v',
    responseType: 'token',
    deviceLabel: 'Samsung SM-S938B',
    deviceId: 'abcDEF_123-xyz45',
  });
});

test('sign-in asks the platform for the device and still signs in when it cannot say', async () => {
  const attempt = '1aaad26d-22ef-4b26-98ba-d55d2d166f70';
  const state = 'S'.repeat(43);
  for (const device of [
    async () => ({ label: 'Samsung SM-S938B', id: 'abcDEF_123-xyz45' }),
    async (): Promise<{ label?: string }> => {
      throw new Error('secure store unavailable');
    },
  ]) {
    const storage = new Map<string, string>();
    const exchanges: Record<string, unknown>[] = [];
    const platform: AuthPlatform = {
      client: 'android-preview',
      get: async (key) => storage.get(key) ?? null,
      set: async (key, value) => void storage.set(key, value),
      remove: async (key) => void storage.delete(key),
      random: async () => state,
      challenge: async () => state,
      device,
      open: async () => ({
        type: 'success',
        url: `com.trainingai.app.preview:/auth/callback?${new URLSearchParams({ state, token: attempt })}`,
      }),
      dismiss() {},
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
        if (path === '/api/auth/exchange-mobile-token') {
          exchanges.push(JSON.parse(String(init?.body)));
          return json({ ok: true, tokenType: 'Bearer', accessToken: 'a', expiresAt: 4_000_000_000 });
        }
        return json({
          user: { id: 'u', email: 'me@example.com', name: 'Sam', timezone: null, isActive: true },
          signInProviders: ['google'],
        });
      }) as typeof fetch,
    };
    const session = new AccountSession('https://example.com', platform);
    await session.initialize(null);
    await session.signIn();
    assert.equal(session.state.status, 'signedIn');
    assert.equal(exchanges.length, 1);
    const sent = exchanges[0];
    if (sent.deviceLabel) assert.deepEqual([sent.deviceLabel, sent.deviceId], ['Samsung SM-S938B', 'abcDEF_123-xyz45']);
    else assert.equal('deviceId' in sent, false);
  }
});

test('This device is listed first, then the others newest sign-in first', () => {
  const device = (id: string, signedInAt: string, current = false) => ({
    id,
    label: id,
    signedInAt,
    lastUsedAt: signedInAt,
    current,
  });
  const list = [
    device('old', '2026-09-01T00:00:00.000Z'),
    device('here', '2026-08-01T00:00:00.000Z', true),
    device('new', '2026-10-20T00:00:00.000Z'),
    device('mid', '2026-10-01T00:00:00.000Z'),
  ];
  assert.deepEqual(orderDevices(list).map((d) => d.id), ['here', 'new', 'mid', 'old']);
  assert.deepEqual(list.map((d) => d.id), ['old', 'here', 'new', 'mid']);
});
