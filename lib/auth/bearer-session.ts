import type { Session } from 'next-auth';
import { refreshIsActiveClaim, type ClaimUser } from './is-active-refresh';
import { sessionTokenFrom } from './session-token';
import { sessionFromToken } from './session';
import { getRepositoryAsync } from '@/lib/data';
import { hashRefreshToken } from './refresh-token-hash';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function bearerSession(
  headers: Headers,
  lookup: (userId: string) => Promise<ClaimUser | null>,
): Promise<Session | null> {
  const token = await sessionTokenFrom(headers);
  if (!token?.userId) {
    return null;
  }
  if (token.nativeTokenId !== undefined) {
    // A one-day native token (#2076): valid while the refresh-token row it was issued with is the
    // user's and its family is not revoked. A rotated row is fine — the token keeps its own `exp`.
    if (typeof token.nativeTokenId !== 'string' || !UUID_RE.test(token.nativeTokenId)) return null;
    try {
      const stored = await (await getRepositoryAsync()).findNativeRefreshTokenById(token.userId, token.nativeTokenId);
      if (
        !stored ||
        stored.userId !== token.userId ||
        stored.revokedAt ||
        stored.expiresAt.getTime() <= Date.now()
      )
        return null;
    } catch {
      throw new Error('Native session verification is temporarily unavailable');
    }
  } else if (token.nativeSessionKey !== undefined) {
    // A seven-day token issued before #2076. Honoured until it expires so installed apps stay
    // signed in across the deploy; nothing issues these any more.
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
