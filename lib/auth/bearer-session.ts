import type { Session } from 'next-auth';
import { refreshIsActiveClaim, type ClaimUser } from './is-active-refresh';
import { sessionTokenFrom } from './session-token';
import { sessionFromToken } from './session';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken } from './refresh-token-hash';

export async function bearerSession(
  headers: Headers,
  lookup: (userId: string) => Promise<ClaimUser | null>,
): Promise<Session | null> {
  const token = await sessionTokenFrom(headers);
  if (!token?.userId) {
    return null;
  }
  if (token.nativeSessionKey !== undefined) {
    const hash =
      typeof token.nativeSessionKey === 'string'
        ? hashRefreshToken(token.nativeSessionKey)
        : null;
    if (!hash) return null;
    try {
      const stored = await (await getRepositoryAsync()).findNativeRefreshTokenByHash(hash);
      if (
        !stored ||
        stored.userId !== token.userId ||
        stored.revokedAt ||
        stored.rotatedAt ||
        stored.expiresAt.getTime() <= Date.now()
      )
        return null;
    } catch {
      throw new Error('Native session verification is temporarily unavailable');
    }
  }

  await refreshIsActiveClaim(token, lookup);
  return sessionFromToken(
    {
      user: {
        id: token.userId,
        name: token.name ?? null,
        email: token.email ?? null,
        image: token.picture ?? null,
      },
      expires: typeof token.exp === 'number' ? new Date(token.exp * 1000).toISOString() : '',
    },
    token,
  );
}
