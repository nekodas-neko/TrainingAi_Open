import { decode, encode } from 'next-auth/jwt';
import type { User } from '@trainingai/shared/types/user';
import { userClaims } from '../user';
import {
  NATIVE_ACCESS_TOKEN_MAX_AGE_SECONDS,
  NATIVE_REFRESH_TOKEN_MAX_AGE_SECONDS,
  NATIVE_SESSION_SALT,
} from '../session';
import { randomBytes } from 'node:crypto';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken } from '../refresh-token-hash';

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
 * `invalid` (unknown, revoked, expired, inactive account) or `reused`: a token that was already
 * rotated, or lost the race to rotate, was presented a second time, so its whole family — the
 * device's sign-in — is revoked. The raw token never leaves this function except in `body`.
 */
export async function rotateNativeSession(rawRefreshToken: string): Promise<NativeRotation> {
  if (!process.env.AUTH_SECRET) throw new Error('Cannot issue session');
  const hash = hashRefreshToken(rawRefreshToken);
  if (!hash) return { ok: false, reason: 'invalid' };
  const repo = await getRepositoryAsync();
  const stored = await repo.findNativeRefreshTokenByHash(hash);
  if (!stored || stored.revokedAt) return { ok: false, reason: 'invalid' };
  const reuse = async (): Promise<NativeRotation> => {
    await repo.revokeNativeRefreshTokenFamily(stored.userId, stored.familyId, 'rotation_reuse');
    return { ok: false, reason: 'reused' };
  };
  if (stored.rotatedAt) return reuse();
  if (stored.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'invalid' };
  const user = await repo.getUserById(stored.userId);
  if (!user?.isActive) return { ok: false, reason: 'invalid' };
  const next = newRefreshToken();
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
