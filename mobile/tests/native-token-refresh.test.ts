// #2076: the one-day access token renews through the refresh token. Renewal happens just before
// expiry and after a 401, once for all concurrent requests; a refused refresh signs out, an
// unreachable server does not; sessions saved before the change keep working until they expire.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountSession } from '../src/features/account/session.ts';
import type { AuthPlatform } from '../src/features/account/session.ts';

const origin = 'https://example.com';
const KEY = 'fitnessai.session.v1';
const now = () => Math.floor(Date.now() / 1000);
const profile = { id: 'user-1', email: 'me@example.com', name: 'Sam', timezone: null, isActive: true };
const refreshToken = (n: number) => `${String(n).padStart(4, '0')}${'r'.repeat(39)}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

type Call = { path: string; authorization: string | null; body: Record<string, unknown> };

function fixture(saved: Record<string, unknown> | null) {
  const storage = new Map<string, string>();
  if (saved) {
    storage.set(KEY, JSON.stringify({ origin, userId: profile.id, ...saved }));
  }
  const calls: Call[] = [];
  const revoked: { accessToken: string; refreshToken?: string }[] = [];
  let issued = 0;
  /** Access tokens the fake server accepts. */
  const valid = new Set<string>();
  const server = {
    refresh: async (body: Record<string, unknown>): Promise<Response> => {
      issued += 1;
      const accessToken = `access-${issued}`;
      valid.add(accessToken);
      return json({
        ok: true,
        tokenType: 'Bearer',
        accessToken,
        expiresAt: now() + 86_400,
        refreshToken: refreshToken(issued),
        refreshExpiresAt: now() + 30 * 86_400,
        presented: body.refreshToken,
      });
    },
    profile: async (): Promise<Response> => json({ user: profile, signInProviders: ['google'] }),
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const authorization = new Headers(init?.headers).get('authorization');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, authorization, body });
    if (path === '/api/auth/native-session/refresh') {
      return server.refresh(body);
    }
    if (!authorization || !valid.has(authorization.replace('Bearer ', ''))) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (path === '/api/user/profile') {
      return server.profile();
    }
    return json({ ok: true, path });
  }) as typeof fetch;
  const platform: AuthPlatform = {
    fetch: fetcher,
    get: async (key) => storage.get(key) ?? null,
    set: async (key, value) => {
      storage.set(key, value);
    },
    remove: async (key) => {
      storage.delete(key);
    },
    random: async () => 'S'.repeat(43),
    challenge: async () => 'S'.repeat(43),
    open: async () => ({ type: 'cancel' }),
    dismiss() {},
    revokeSession: async (_origin, accessToken, presented) => {
      revoked.push({ accessToken, ...(presented ? { refreshToken: presented } : {}) });
    },
  };
  const stored = () => JSON.parse(storage.get(KEY) ?? 'null');
  const refreshes = () => calls.filter((c) => c.path === '/api/auth/native-session/refresh');
  return { controller: new AccountSession(origin, platform), storage, calls, valid, server, stored, refreshes, revoked };
}

const renewable = (expiresIn: number, accessToken = 'access-0') => ({
  accessToken,
  expiresAt: now() + expiresIn,
  refreshToken: refreshToken(0),
  refreshExpiresAt: now() + 20 * 86_400,
});

test('renews just before expiry, then uses and saves the new pair', async () => {
  const f = fixture(renewable(60));
  f.valid.add('access-0');
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedIn');
  assert.equal(f.refreshes().length, 1);
  assert.equal(f.refreshes()[0].authorization, null);
  assert.deepEqual(f.refreshes()[0].body, { refreshToken: refreshToken(0) });
  assert.equal(f.calls.find((c) => c.path === '/api/user/profile')?.authorization, 'Bearer access-1');
  assert.equal(f.stored().refreshToken, refreshToken(1));
  assert.equal(f.stored().accessToken, 'access-1');
  assert.equal(f.stored().userId, profile.id);
});

test('a session whose access token already lapsed is kept and renewed on launch', async () => {
  const f = fixture(renewable(-3600));
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedIn');
  assert.equal(f.stored().accessToken, 'access-1');
});

test('a token far from expiry is used as is', async () => {
  const f = fixture(renewable(86_000));
  f.valid.add('access-0');
  await f.controller.initialize(null);
  assert.equal(f.refreshes().length, 0);
  assert.equal(f.controller.state.status, 'signedIn');
});

test('concurrent requests share one refresh', async () => {
  const f = fixture(renewable(60));
  f.valid.add('access-0');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const refresh = f.server.refresh;
  f.server.refresh = async (body) => {
    await gate;
    return refresh(body);
  };
  // The launch-time account check and three screen requests all want a token at once.
  const launch = f.controller.initialize(null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const reader = f.controller.dataReader!;
  const results = Promise.all([reader.get('/api/a'), reader.get('/api/b'), reader.post('/api/c', { x: 1 })]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await Promise.all([launch, results]);
  assert.equal(f.refreshes().length, 1);
  assert.equal(f.controller.state.status, 'signedIn');
  const used = f.calls.filter((c) => c.path !== '/api/auth/native-session/refresh');
  assert.equal(used.length, 4);
  assert.ok(used.every((c) => c.authorization === 'Bearer access-1'));
});

test('a 401 renews and retries once; a second 401 is returned, not retried again', async () => {
  const f = fixture(renewable(86_000));
  f.valid.add('access-0');
  await f.controller.initialize(null);
  const reader = f.controller.dataReader!;
  // The server stops accepting the current token (say, a clock difference).
  f.valid.delete('access-0');
  assert.deepEqual(await reader.get('/api/x'), { ok: true, path: '/api/x' });
  const x = f.calls.filter((c) => c.path === '/api/x');
  assert.deepEqual(x.map((c) => c.authorization), ['Bearer access-0', 'Bearer access-1']);
  assert.equal(f.refreshes().length, 1);

  // Now nothing is accepted: one refresh, one retry, then the 401 surfaces.
  const refresh = f.server.refresh;
  f.server.refresh = async (body) => {
    const response = await refresh(body);
    f.valid.clear();
    return response;
  };
  f.valid.clear();
  await assert.rejects(reader.get('/api/y'), (e: { status?: number }) => e.status === 401);
  assert.equal(f.calls.filter((c) => c.path === '/api/y').length, 2);
  assert.equal(f.refreshes().length, 2);
});

test('offline: the session, saved data and sign-in survive; it renews once the network is back', async () => {
  const f = fixture(renewable(-60));
  const refresh = f.server.refresh;
  f.server.refresh = async () => {
    throw new TypeError('Network request failed');
  };
  await f.controller.initialize(null);
  assert.notEqual(f.controller.state.status, 'signedOut');
  assert.equal(f.controller.state.hasSession, true);
  assert.match(f.controller.state.message ?? '', /connection/);
  assert.equal(f.stored().refreshToken, refreshToken(0));
  const reader = f.controller.dataReader!;
  await assert.rejects(reader.get('/api/x'), /renew the session/);
  assert.equal(f.stored().refreshToken, refreshToken(0));

  // Server errors and rate limits are treated the same way.
  for (const status of [429, 500, 503]) {
    f.server.refresh = async () => json({ error: 'busy' }, status);
    await assert.rejects(reader.get('/api/x'));
    assert.equal(f.controller.state.hasSession, true);
  }

  f.server.refresh = refresh;
  assert.deepEqual(await reader.get('/api/x'), { ok: true, path: '/api/x' });
  assert.equal(f.stored().refreshToken, refreshToken(1));
});

test('a refused refresh signs out cleanly and clears secure storage', async () => {
  const f = fixture(renewable(60));
  f.server.refresh = async () => json({ error: 'invalid_refresh_token' }, 401);
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedOut');
  assert.match(f.controller.state.message ?? '', /Sign in again/);
  assert.equal(f.storage.has(KEY), false);
  assert.equal(f.controller.dataReader, null);
  // An automatic sign-out does not call the revoke route; the server already refused the token.
  assert.equal(f.revoked.length, 0);
});

test('a renewal that lands while the profile is loading is not overwritten by the profile save', async () => {
  const f = fixture(renewable(86_000));
  f.valid.add('access-0');
  await f.controller.initialize(null);
  const reader = f.controller.dataReader!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  f.server.profile = async () => {
    await gate;
    return json({ user: profile, signInProviders: ['google'] });
  };
  const check = f.controller.refresh();
  await new Promise((resolve) => setTimeout(resolve, 5));
  f.valid.delete('access-0');
  await reader.get('/api/x');
  assert.equal(f.stored().refreshToken, refreshToken(1));
  release();
  await check;
  assert.equal(f.stored().refreshToken, refreshToken(1));
  assert.equal(f.stored().accessToken, 'access-1');
});

test('sign-out sends the refresh token so the sign-in is revoked even after the access token lapsed', async () => {
  const f = fixture(renewable(86_000));
  f.valid.add('access-0');
  await f.controller.initialize(null);
  await f.controller.signOut();
  assert.deepEqual(f.revoked, [{ accessToken: 'access-0', refreshToken: refreshToken(0) }]);
  assert.equal(f.storage.has(KEY), false);
});

test('a session saved before #2076 keeps working until it expires, and never tries to refresh', async () => {
  const f = fixture({ accessToken: 'legacy', expiresAt: now() + 3600 });
  f.valid.add('legacy');
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedIn');
  const reader = f.controller.dataReader!;
  f.valid.delete('legacy');
  await assert.rejects(reader.get('/api/x'), (e: { status?: number }) => e.status === 401);
  assert.equal(f.calls.filter((c) => c.path === '/api/x').length, 1);
  assert.equal(f.refreshes().length, 0);

  const expired = fixture({ accessToken: 'legacy', expiresAt: now() - 1 });
  await expired.controller.initialize(null);
  assert.equal(expired.controller.state.status, 'signedOut');
  assert.equal(expired.storage.has(KEY), false);
});

test('a saved refresh token of the wrong shape is not trusted', async () => {
  const f = fixture({ ...renewable(-60), refreshToken: 'short' });
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedOut');
  assert.equal(f.refreshes().length, 0);
});
