import { decode, encode } from 'next-auth/jwt';
import type { User } from '@trainingai/shared/types/user';
import { userClaims } from '../user';
import { SESSION_MAX_AGE_SECONDS, NATIVE_SESSION_SALT } from '../session';
import { randomBytes } from 'node:crypto';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken } from '../refresh-token-hash';

export async function issueNativeSession(user: User) {
  if (!user.isActive || !process.env.AUTH_SECRET) {
    throw new Error('Cannot issue session');
  }
  const secret = process.env.AUTH_SECRET;
  const nativeSessionKey = randomBytes(32).toString('base64url');
  await (
    await getRepositoryAsync()
  ).createNativeRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(nativeSessionKey)!,
    deviceLabel: 'Native app',
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  const salt = NATIVE_SESSION_SALT;
  const accessToken = await encode({
    secret,
    salt,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      ...userClaims(user),
      userId: user.id,
      name: user.name ?? null,
      email: user.email,
      nativeSessionKey,
    },
  });
  const token = await decode({ token: accessToken, secret, salt });
  if (!token?.exp) {
    throw new Error('Cannot read session expiry');
  }
  return { ok: true, accessToken, tokenType: 'Bearer', expiresAt: token.exp };
}
