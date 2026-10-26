import { decode, encode } from 'next-auth/jwt';
import type { User } from '@trainingai/shared/types/user';
import { userClaims } from '../user';
import {
  NATIVE_ACCESS_TOKEN_MAX_AGE_SECONDS,
  NATIVE_REFRESH_REUSE_GRACE_SECONDS,
  NATIVE_REFRESH_TOKEN_MAX_AGE_SECONDS,
  NATIVE_SESSION_SALT,
} from '../session';
import { sessionTokenFrom } from '../session-token';
import { randomBytes } from 'node:crypto';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken } from '../refresh-token-hash';
import { nowSeconds } from '../session-cutoff';

// #2076. A native sign-in is a refresh token (stored only as a hash, one family per device sign-in)
// plus a one-day access token that names the refresh-token row it was issued with. The bearer check
// refuses the access token once that row's family is revoked, and the app swaps the refresh token
// for a new pair before the access token runs out (`rotateNativeSession`).
//
// Tokens issued before this carried `nativeSessionKey` and a seven-day life. `bearerSession` still
// honours them until they expire, so an installed app is not signed out by the deploy.

export type NativeSessionResponse = {
  ok: true;
  tokenType: 'Bearer';
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

function newRefreshToken() {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw)! };
}

const refreshExpiry = () => new Date(Date.now() + NATIVE_REFRESH_TOKEN_MAX_AGE_SECONDS * 1000);

async function accessTokenFor(user: User, nativeTokenId: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('Cannot issue session');
  const salt = NATIVE_SESSION_SALT;
  const accessToken = await encode({
    secret,
    salt,
    maxAge: NATIVE_ACCESS_TOKEN_MAX_AGE_SECONDS,
    token: {
      ...userClaims(user),
      userId: user.id,
      name: user.name ?? null,
      email: user.email,
      nativeTokenId,
      // #3369: the refresh-token row is what ties this token to a sign-in (a reset deletes it), so
      // the stamp is the issue time. That makes it right for the session cut-off, which only asks
      // "issued after the reset?", and wrong as a sign-in time: every rotation moves it. So
      // `/api/account/data-epoch` does not report it for a bearer request.
      signedInAt: nowSeconds(),
    },
  });
  const token = await decode({ token: accessToken, secret, salt });
  if (!token?.exp) {
    throw new Error('Cannot read session expiry');
  }
  return { accessToken, expiresAt: token.exp };
}

function response(
  access: { accessToken: string; expiresAt: number },
  refreshToken: string,
  refreshExpiresAt: Date,
): NativeSessionResponse {
  return {
    ok: true,
    tokenType: 'Bearer',
    ...access,
    refreshToken,
    refreshExpiresAt: Math.floor(refreshExpiresAt.getTime() / 1000),
  };
}

export async function issueNativeSession(user: User): Promise<NativeSessionResponse> {
  if (!user.isActive || !process.env.AUTH_SECRET) {
    throw new Error('Cannot issue session');
  }
  const refresh = newRefreshToken();
  const row = await (
    await getRepositoryAsync()
  ).createNativeRefreshToken({
    userId: user.id,
    tokenHash: refresh.hash,
    deviceLabel: 'Native app',
    expiresAt: refreshExpiry(),
  });
  return response(await accessTokenFor(user, row.id), refresh.raw, row.expiresAt);
}

export type NativeRotation =
  | { ok: true; body: NativeSessionResponse }
  | { ok: false; reason: 'invalid' | 'reused' };

/**
 * Swap a presented refresh token for a new access token and its successor. Every failure is
 * `invalid` (unknown, revoked, expired, inactive account) or `reused`, which revokes the whole
 * family — the device's sign-in:
 * - a token presented again after it was rotated, unless the grace below applies;
 * - the loser of two rotations of one token at the same moment;
 * - a successor that the grace replaced, presented later: two parties held the chain.
 *
 * The grace: a token rotated under `NATIVE_REFRESH_REUSE_GRACE_SECONDS` ago whose successor has not
 * been used is a response the app never received. The unused successor is revoked and a new one
 * issued, so a dropped connection mid-refresh does not sign the device out. The raw token never
 * leaves this function except in `body`, and is never logged.
 */
export async function rotateNativeSession(rawRefreshToken: string): Promise<NativeRotation> {
  if (!process.env.AUTH_SECRET) throw new Error('Cannot issue session');
  const hash = hashRefreshToken(rawRefreshToken);
  if (!hash) return { ok: false, reason: 'invalid' };
  const repo = await getRepositoryAsync();
  const stored = await repo.findNativeRefreshTokenByHash(hash);
  if (!stored) return { ok: false, reason: 'invalid' };
  const reuse = async (): Promise<NativeRotation> => {
    const revoked = await repo.revokeNativeRefreshTokenFamily(stored.userId, stored.familyId, 'rotation_reuse');
    // A theft signal. Ids only: never the token or its hash.
    console.warn('[native-session] refresh token reused; family revoked', {
      userId: stored.userId,
      familyId: stored.familyId,
      revoked,
    });
    return { ok: false, reason: 'reused' };
  };
  if (stored.revokedAt) {
    return stored.revokedReason === 'rotation_reuse' ? reuse() : { ok: false, reason: 'invalid' };
  }
  const user = await repo.getUserById(stored.userId);
  if (!user?.isActive) return { ok: false, reason: 'invalid' };
  // #3369, defence in depth: an admin reset deletes the account's refresh tokens, so none from before
  // it should exist. If one does (a row written by a request that raced the reset), it must not mint
  // a fresh `signedInAt` and so carry a pre-reset device back in.
  if (user.sessionsValidFrom && stored.createdAt.getTime() < user.sessionsValidFrom.getTime()) {
    return { ok: false, reason: 'invalid' };
  }
  const next = newRefreshToken();
  if (stored.rotatedAt) {
    const regranted = await repo.regrantNativeRefreshToken({
      userId: stored.userId,
      id: stored.id,
      newTokenHash: next.hash,
      expiresAt: refreshExpiry(),
      graceSeconds: NATIVE_REFRESH_REUSE_GRACE_SECONDS,
    });
    if (!regranted) return reuse();
    return {
      ok: true,
      body: response(await accessTokenFor(user, regranted.id), next.raw, regranted.expiresAt),
    };
  }
  if (stored.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'invalid' };
  const rotated = await repo.rotateNativeRefreshToken({
    userId: stored.userId,
    id: stored.id,
    newTokenHash: next.hash,
    expiresAt: refreshExpiry(),
  });
  // Null after the checks above means another request rotated (or revoked) it first.
  if (!rotated) return reuse();
  return {
    ok: true,
    body: response(await accessTokenFor(user, rotated.id), next.raw, rotated.expiresAt),
  };
}

/**
 * The family a request's own native bearer token was issued from, or null for a cookie session, a
 * legacy token whose row is gone, or another user's row. Sign-out and Apple linking use it to end
 * the sign-in the request came from.
 */
export async function presentedNativeFamily(headers: Headers, userId: string): Promise<string | null> {
  const token = await sessionTokenFrom(headers);
  const repo = await getRepositoryAsync();
  let stored = null;
  if (typeof token?.nativeTokenId === 'string') {
    stored = await repo.findNativeRefreshTokenById(userId, token.nativeTokenId);
  } else if (typeof token?.nativeSessionKey === 'string') {
    const hash = hashRefreshToken(token.nativeSessionKey);
    if (hash) stored = await repo.findNativeRefreshTokenByHash(hash);
  }
  return stored?.userId === userId ? stored.familyId : null;
}
