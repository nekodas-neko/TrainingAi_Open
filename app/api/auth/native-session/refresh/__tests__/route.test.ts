// #2076. The refresh route and the one-day native token, against an in-memory repository that
// keeps the `native_refresh_tokens` slice's rules: lookup by hash in any state, lookup by id scoped
// to the user, rotation only of a live row, family revocation. The slice itself is tested against
// Postgres in lib/data/postgres/__tests__/native-refresh-tokens.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

type Row = {
  id: string; userId: string; familyId: string; tokenHash: string; expiresAt: Date;
  rotatedAt: Date | null; replacedBy: string | null; revokedAt: Date | null; revokedReason: string | null;
};
const db = vi.hoisted(() => ({ rows: [] as unknown[], users: new Map<string, unknown>(), fail: false, rateOk: true }));
const rows = () => db.rows as Row[];
const live = (r: Row) => !r.rotatedAt && !r.revokedAt && r.expiresAt.getTime() > Date.now();
const strip = ({ tokenHash: _h, ...r }: Row) => ({ ...r });
const guard = () => { if (db.fail) throw new Error('database offline: SELECT … $1') };

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => db.rateOk }));
vi.mock('@/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    async createNativeRefreshToken(i: { userId: string; tokenHash: string; expiresAt: Date }) {
      guard();
      const row: Row = { id: randomUUID(), familyId: randomUUID(), rotatedAt: null, replacedBy: null, revokedAt: null, revokedReason: null, ...i };
      rows().push(row);
      return strip(row);
    },
    async findNativeRefreshTokenByHash(h: string) {
      guard();
      const r = rows().find(x => x.tokenHash === h);
      return r ? strip(r) : null;
    },
    async findNativeRefreshTokenById(userId: string, id: string) {
      guard();
      const r = rows().find(x => x.id === id && x.userId === userId);
      return r ? strip(r) : null;
    },
    async rotateNativeRefreshToken(i: { userId: string; id: string; newTokenHash: string; expiresAt: Date }) {
      guard();
      const old = rows().find(x => x.id === i.id && x.userId === i.userId && live(x));
      if (!old) return null;
      old.rotatedAt = new Date();
      const next: Row = { id: randomUUID(), userId: i.userId, familyId: old.familyId, tokenHash: i.newTokenHash, expiresAt: i.expiresAt, rotatedAt: null, replacedBy: null, revokedAt: null, revokedReason: null };
      rows().push(next);
      old.replacedBy = next.id;
      return strip(next);
    },
    async revokeNativeRefreshTokenFamily(userId: string, familyId: string, reason: string) {
      guard();
      const hit = rows().filter(x => x.userId === userId && x.familyId === familyId && !x.revokedAt);
      for (const r of hit) { r.revokedAt = new Date(); r.revokedReason = reason; }
      return hit.length;
    },
    async getUserById(id: string) { guard(); return db.users.get(id) ?? null },
  }),
}));

import { POST as refresh } from '../route';
import { POST as revoke } from '../../revoke/route';
import { issueNativeSession } from '@/lib/auth/mobile/session';
import { bearerSession } from '@/lib/auth/bearer-session';
import { hashRefreshToken } from '@/lib/auth/refresh-token-hash';
import { NATIVE_SESSION_SALT } from '@/lib/auth/session';

const SECRET = 'native-refresh-test-secret-long-enough-to-derive';
const user = (id: string) => ({ id, email: `${id}@example.invalid`, isActive: true, isAdmin: false, createdAt: new Date(), timezone: 'Australia/Brisbane' });
const ALICE = user('alice');
const BOB = user('bob');
const post = (body: unknown, raw = false) =>
  refresh(new NextRequest('https://example.com/api/auth/native-session/refresh', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body),
  }));
const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` });
const lookup = async (id: string) => (db.users.get(id) as { isActive: boolean } | undefined) ?? null;

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET);
  db.rows = []; db.fail = false; db.rateOk = true;
  db.users = new Map([[ALICE.id, ALICE], [BOB.id, BOB]]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks() });

describe('issueNativeSession (#2076)', () => {
  it('issues a one-day access token and a 30-day refresh token stored only as a hash', async () => {
    const issued = await issueNativeSession(ALICE);
    const now = Date.now() / 1000;
    expect(issued.expiresAt - now).toBeGreaterThan(24 * 3600 - 60);
    expect(issued.expiresAt - now).toBeLessThanOrEqual(24 * 3600);
    expect(issued.refreshExpiresAt - now).toBeGreaterThan(30 * 86400 - 60);
    expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows()[0].tokenHash).toBe(hashRefreshToken(issued.refreshToken));
    expect(JSON.stringify(rows())).not.toContain(issued.refreshToken);
    expect((await bearerSession(bearer(issued.accessToken), lookup))?.user.id).toBe(ALICE.id);
  });
});

describe('POST /api/auth/native-session/refresh', () => {
  it('valid: returns a new pair, rotates the row, and is private, no-store', async () => {
    const issued = await issueNativeSession(ALICE);
    const res = await post({ refreshToken: issued.refreshToken });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, tokenType: 'Bearer' });
    expect(body.refreshToken).not.toBe(issued.refreshToken);
    expect(body.accessToken).not.toBe(issued.accessToken);
    expect((await bearerSession(bearer(body.accessToken), lookup))?.user.id).toBe(ALICE.id);
    // The access token issued with the rotated row keeps working until its own expiry.
    expect((await bearerSession(bearer(issued.accessToken), lookup))?.user.id).toBe(ALICE.id);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].rotatedAt).not.toBeNull();
    expect(rows()[0].replacedBy).toBe(rows()[1].id);
    expect(rows()[1].familyId).toBe(rows()[0].familyId);
    // The successor refreshes again (sliding).
    expect((await post({ refreshToken: body.refreshToken })).status).toBe(200);
  });

  it('expired: 401, nothing rotated, family left alone', async () => {
    const issued = await issueNativeSession(ALICE);
    rows()[0].expiresAt = new Date(Date.now() - 1000);
    const res = await post({ refreshToken: issued.refreshToken });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_refresh_token' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].revokedAt).toBeNull();
  });

  it('reused after rotation: 401 and the whole family is revoked, including live access tokens', async () => {
    const issued = await issueNativeSession(ALICE);
    const next = await (await post({ refreshToken: issued.refreshToken })).json();
    const reuse = await post({ refreshToken: issued.refreshToken });
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ error: 'invalid_refresh_token' });
    expect(rows().every(r => r.revokedReason === 'rotation_reuse')).toBe(true);
    expect((await post({ refreshToken: next.refreshToken })).status).toBe(401);
    expect(await bearerSession(bearer(next.accessToken), lookup)).toBeNull();
    expect(await bearerSession(bearer(issued.accessToken), lookup)).toBeNull();
  });

  it('two concurrent refreshes with one token: one wins, the loser is treated as reuse', async () => {
    const issued = await issueNativeSession(ALICE);
    const [a, b] = await Promise.all([post({ refreshToken: issued.refreshToken }), post({ refreshToken: issued.refreshToken })]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    expect(rows().every(r => r.revokedAt)).toBe(true);
  });

  it("another user's token: never crosses accounts", async () => {
    const alice = await issueNativeSession(ALICE);
    const bob = await issueNativeSession(BOB);
    const body = await (await post({ refreshToken: bob.refreshToken })).json();
    expect((await bearerSession(bearer(body.accessToken), lookup))?.user.id).toBe(BOB.id);
    // An access token naming Bob's row but claiming Alice is refused.
    const forged = await encode({
      secret: SECRET, salt: NATIVE_SESSION_SALT, maxAge: 3600,
      token: { userId: ALICE.id, isActive: true, nativeTokenId: rows()[1].id },
    });
    expect(await bearerSession(bearer(forged), lookup)).toBeNull();
    // Bob's reuse revokes Bob's family only.
    await post({ refreshToken: bob.refreshToken });
    expect((await bearerSession(bearer(alice.accessToken), lookup))?.user.id).toBe(ALICE.id);
    expect((await post({ refreshToken: alice.refreshToken })).status).toBe(200);
  });

  it('revoked or unknown token, or an inactive account: 401', async () => {
    const issued = await issueNativeSession(ALICE);
    expect((await post({ refreshToken: 'A'.repeat(43) })).status).toBe(401);
    rows()[0].revokedAt = new Date();
    expect((await post({ refreshToken: issued.refreshToken })).status).toBe(401);
    const other = await issueNativeSession(BOB);
    db.users.set(BOB.id, { ...BOB, isActive: false });
    expect((await post({ refreshToken: other.refreshToken })).status).toBe(401);
  });

  it('malformed: 400 without touching the database', async () => {
    db.fail = true;
    for (const body of [{}, { refreshToken: 'short' }, { refreshToken: 42 }, { refreshToken: 'A'.repeat(43), extra: 1 }, null, []]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post('{not json', true)).status).toBe(400);
    expect((await post('x'.repeat(5000), true)).status).toBe(413);
  });

  it('fails closed with 503 when the database is down, and never logs the token', async () => {
    const issued = await issueNativeSession(ALICE);
    db.fail = true;
    const logged: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { logged.push(a) });
    vi.spyOn(console, 'warn').mockImplementation((...a) => { logged.push(a) });
    const res = await post({ refreshToken: issued.refreshToken });
    expect(res.status).toBe(503);
    expect(JSON.stringify(logged)).not.toContain(issued.refreshToken);
    expect(JSON.stringify(logged)).not.toContain('$1');
    expect(JSON.stringify(await res.json())).not.toContain(issued.refreshToken);
  });

  it('is rate-limited', async () => {
    db.rateOk = false;
    expect((await post({ refreshToken: 'A'.repeat(43) })).status).toBe(429);
  });
});

describe('sign-out with a refresh token', () => {
  it('revokes the family even after the access token has lapsed', async () => {
    const issued = await issueNativeSession(ALICE);
    const res = await revoke(new NextRequest('https://example.com/api/auth/native-session/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: issued.refreshToken }),
    }));
    expect(res.status).toBe(200);
    expect(rows()[0].revokedReason).toBe('sign_out');
    expect(await bearerSession(bearer(issued.accessToken), lookup)).toBeNull();
    expect((await post({ refreshToken: issued.refreshToken })).status).toBe(401);
  });
});

describe('seven-day tokens issued before #2076', () => {
  const legacy = async (key: string, userId = ALICE.id) =>
    encode({
      secret: SECRET, salt: NATIVE_SESSION_SALT, maxAge: 7 * 24 * 3600,
      token: { userId, isActive: true, nativeSessionKey: key },
    });
  const seed = (key: string, over: Partial<Row> = {}) =>
    rows().push({ id: randomUUID(), userId: ALICE.id, familyId: randomUUID(), tokenHash: hashRefreshToken(key)!, expiresAt: new Date(Date.now() + 7 * 86_400_000), rotatedAt: null, replacedBy: null, revokedAt: null, revokedReason: null, ...over });

  it('keep working until they expire', async () => {
    const key = 'K'.repeat(43);
    seed(key);
    const token = await legacy(key);
    expect((await bearerSession(bearer(token), lookup))?.user.id).toBe(ALICE.id);
    vi.useFakeTimers({ now: Date.now() + 7 * 86_400_000 + 1000, toFake: ['Date'] });
    expect(await bearerSession(bearer(token), lookup)).toBeNull();
  });

  it('are still refused once revoked, or when the row is missing or another user\'s', async () => {
    const key = 'L'.repeat(43);
    seed(key, { revokedAt: new Date() });
    expect(await bearerSession(bearer(await legacy(key)), lookup)).toBeNull();
    expect(await bearerSession(bearer(await legacy('M'.repeat(43))), lookup)).toBeNull();
    const bobKey = 'N'.repeat(43);
    seed(bobKey, { userId: BOB.id });
    expect(await bearerSession(bearer(await legacy(bobKey)), lookup)).toBeNull();
  });

  it('cannot be used as a refresh token', async () => {
    const key = 'P'.repeat(43);
    seed(key);
    // The key lives only inside the encrypted token, so a client never holds it; even if presented,
    // the row is a legacy session row and rotates like any other. What matters is the access token
    // itself is not accepted by the refresh route.
    expect((await post({ refreshToken: await legacy(key) })).status).toBe(400);
  });
});
