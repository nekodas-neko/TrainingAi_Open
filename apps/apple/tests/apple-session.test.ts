import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountSession } from '../src/features/account/session.ts';
import type { AuthPlatform } from '../src/features/account/session.ts';

const origin = 'https://example.com';
const state = 'S'.repeat(43);
const nonce = 'N'.repeat(43);
const attemptId = '1aaad26d-22ef-4b26-98ba-d55d2d166f70';
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const profile = { id: 'existing-user', email: 'me@example.com', name: 'Sam', timezone: null, isActive: true };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(saved = false) {
  const storage = new Map<string, string>();
  if (saved) { storage.set('fitnessai.session.v1', JSON.stringify({ origin, userId: profile.id, accessToken: 'previous-session', expiresAt })); }
  const platform: AuthPlatform = {
    get: async key => storage.get(key) ?? null,
    set: async (key, value) => { storage.set(key, value); },
    remove: async key => { storage.delete(key); },
    random: async () => state, challenge: async () => state, open: async () => ({ type: 'cancel' }), dismiss() {},
    appleSignIn: async (receivedNonce, receivedState) => {
      assert.equal(receivedNonce, nonce); assert.equal(receivedState, state);
      return { identityToken: 'apple-proof', state, name: 'Sam' };
    },
  };
  const calls: { path: string; authorization: string | null; body: Record<string, unknown> }[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, authorization: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (path.endsWith('/begin')) { return json({ attemptId, nonce }); }
    if (path.endsWith('/complete')) { return json({ ok: true, tokenType: 'Bearer', accessToken: 'apple-session', expiresAt }); }
    return json({ user: profile, signInProviders: ['google', 'apple'] });
  };
  return { controller: new AccountSession(origin, platform), platform, storage, calls, fetcher };
}

test('Apple login stores the app session and retrieves the existing account profile', async t => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  await f.controller.signInWithApple();
  assert.equal(f.controller.state.status, 'signedIn');
  assert.deepEqual(f.controller.state.profile?.signInProviders, ['google', 'apple']);
  assert.equal(f.calls[0].authorization, null);
  assert.equal(f.calls[1].authorization, null);
  assert.equal(f.calls[2].authorization, 'Bearer apple-session');
  assert.equal(JSON.parse(f.storage.get('fitnessai.session.v1')!).userId, profile.id);
});

test('connecting Apple authenticates both calls and retains the account identity', async t => {
  const f = fixture(true);
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  await f.controller.signInWithApple();
  const appleCalls = f.calls.filter(x => x.path.includes('/apple/'));
  assert.ok(appleCalls.every(x => x.authorization === 'Bearer previous-session'));
  assert.equal(appleCalls[0].body.link, true);
  assert.equal(f.controller.state.profile?.id, profile.id);
});

test('cancelling Apple connection preserves the previous session and profile', async t => {
  const f = fixture(true);
  f.platform.appleSignIn = async () => { throw Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }); };
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  await f.controller.signInWithApple();
  assert.equal(f.controller.state.status, 'signedIn');
  assert.equal(f.controller.state.profile?.id, profile.id);
  assert.match(f.controller.state.message!, /cancelled/);
  assert.equal(JSON.parse(f.storage.get('fitnessai.session.v1')!).accessToken, 'previous-session');
  assert.ok(!f.calls.some(x => x.path.endsWith('/complete')));
});

test('mismatched native state never sends Apple proof to the backend', async t => {
  const f = fixture();
  f.platform.appleSignIn = async () => ({ identityToken: 'proof', state: 'wrong-state' });
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  await f.controller.signInWithApple();
  assert.equal(f.controller.state.status, 'signedOut');
  assert.ok(!f.calls.some(x => x.path.endsWith('/complete')));
});

test('approval and account-link errors explain the next step without saving a session', async t => {
  for (const [status, error, message] of [[403, 'account_pending', /awaiting approval/], [409, 'account_link_required', /account you already use/]] as const) {
    const f = fixture();
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith('/complete') ? json({ error }, status) : f.fetcher(input, init));
    await f.controller.initialize(null);
    await f.controller.signInWithApple();
    assert.equal(f.controller.state.status, 'signedOut');
    assert.match(f.controller.state.message!, message);
    assert.ok(!f.storage.has('fitnessai.session.v1'));
    t.mock.restoreAll();
  }
});

test('sign-out during the native sheet prevents late proof from restoring a session', async t => {
  const f = fixture();
  let finish: ((value: { identityToken: string; state: string }) => void) | undefined;
  f.platform.appleSignIn = () => new Promise(resolve => { finish = resolve; });
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  const login = f.controller.signInWithApple();
  while (!finish) { await new Promise(resolve => setImmediate(resolve)); }
  await f.controller.signOut();
  finish({ identityToken: 'late-proof', state });
  await login;
  assert.equal(f.controller.state.status, 'signedOut');
  assert.ok(!f.storage.has('fitnessai.session.v1'));
  assert.ok(!f.calls.some(x => x.path.endsWith('/complete')));
});

test('saved account identity remains available for scoped reads when profile refresh is offline', async t => {
  const f = fixture(true);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await f.controller.initialize(null);
  assert.equal(f.controller.dataReader?.userId, profile.id);
  assert.equal(f.controller.dataReader?.origin, origin);
});

test('a reader rejects late data after sign-out and cannot make further authenticated requests', async t => {
  const f = fixture(true);
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  const reader = f.controller.dataReader!;
  let release!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { release = resolve; }));
  const request = reader.get('/api/workout-data', { tab: 'meta' });
  const rejected = assert.rejects(request, /account changed/);
  while (!release) { await new Promise(resolve => setImmediate(resolve)); }
  await f.controller.signOut();
  release(json({ program: 'late-data' }));
  await rejected;
  assert.equal(f.controller.dataReader, null);
  await assert.rejects(reader.get('/api/workout-data'), /Sign in/);
});

test('a previous account reader cannot use a different account’s new session', async t => {
  const f = fixture(true);
  t.mock.method(globalThis, 'fetch', f.fetcher);
  await f.controller.initialize(null);
  const previous = f.controller.dataReader!;
  await f.controller.signOut();
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) =>
    new URL(String(input)).pathname === '/api/user/profile'
      ? json({ user: { ...profile, id: 'other-user' } }) : f.fetcher(input, init));
  await f.controller.signInWithApple();
  assert.equal(f.controller.dataReader?.userId, 'other-user');
  const calls = f.calls.length;
  await assert.rejects(previous.get('/api/workout-data'), /Sign in/);
  assert.equal(f.calls.length, calls);
});
