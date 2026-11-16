// #3806: once the user signs out, a response that was already in flight writes nothing back, even
// when the same account has signed in again before it lands, and a renewal finishing after the
// sign-out does not restore the session.
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
const saved = (expiresIn: number) =>
  JSON.stringify({
    origin, userId: profile.id, accessToken: 'access-0', expiresAt: now() + expiresIn,
    refreshToken: refreshToken(0), refreshExpiresAt: now() + 20 * 86_400,
  });

function fixture(expiresIn = 86_000) {
  const storage = new Map<string, string>([[KEY, saved(expiresIn)]]);
  const gates = new Map<string, Promise<void>>();
  const fetcher = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    await gates.get(path);
    if (path === '/api/auth/native-session/refresh') {
      return json({
        ok: true, tokenType: 'Bearer', accessToken: 'access-1', expiresAt: now() + 86_400,
        refreshToken: refreshToken(1), refreshExpiresAt: now() + 30 * 86_400,
      });
    }
    if (path === '/api/user/profile') return json({ user: profile, signInProviders: ['google'] });
    return json({ ok: true, path });
  }) as typeof fetch;
  const platform: AuthPlatform = {
    fetch: fetcher,
    get: async (key) => storage.get(key) ?? null,
    set: async (key, value) => void storage.set(key, value),
    remove: async (key) => void storage.delete(key),
    random: async () => 'S'.repeat(43),
    challenge: async () => 'S'.repeat(43),
    open: async () => ({ type: 'cancel' }),
    dismiss() {},
  };
  const gate = (path: string) => {
    let release!: () => void;
    gates.set(path, new Promise<void>((resolve) => (release = resolve)));
    return () => release();
  };
  return { controller: new AccountSession(origin, platform), storage, gate };
}

test('a read that resolves after sign-out is discarded', async () => {
  const f = fixture();
  await f.controller.initialize(null);
  const release = f.gate('/api/workouts');
  const late = f.controller.dataReader!.get('/api/workouts');
  await f.controller.signOut();
  release();
  await assert.rejects(late, /account changed/);
  assert.equal(f.storage.has(KEY), false);
  assert.equal(f.controller.state.status, 'signedOut');
});

test('a read from before a sign-out is discarded even when the same account signed back in', async () => {
  const f = fixture();
  await f.controller.initialize(null);
  const release = f.gate('/api/workouts');
  const late = f.controller.dataReader!.post('/api/workouts', { x: 1 });
  await f.controller.signOut();
  // The same account signs in again before the old response lands.
  f.storage.set(KEY, saved(86_000));
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedIn');
  release();
  await assert.rejects(late, /account changed/);
  // A request made in the new sign-in is unaffected.
  assert.deepEqual(await f.controller.dataReader!.get('/api/workouts'), { ok: true, path: '/api/workouts' });
});

test('a renewal that finishes after sign-out does not restore the session', async () => {
  const f = fixture(60);
  const release = f.gate('/api/auth/native-session/refresh');
  const launch = f.controller.initialize(null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await f.controller.signOut();
  release();
  await launch.catch(() => {});
  assert.equal(f.storage.has(KEY), false);
  assert.equal(f.controller.dataReader, null);
  assert.equal(f.controller.state.status, 'signedOut');
});
