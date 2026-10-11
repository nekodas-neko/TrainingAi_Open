import type { Session } from 'next-auth'
import { refreshIsActiveClaim } from './is-active-refresh'
import { sessionTokenFrom } from './session-token'
import { sessionFromToken } from './session'

export async function bearerSession(
  headers: Headers,
  lookup: (userId: string) => Promise<{ isActive: boolean; isAdmin?: boolean } | null>,
): Promise<Session | null> {
  const token = await sessionTokenFrom(headers)
  if (!token?.userId) {
    return null
  }

  await refreshIsActiveClaim(token, lookup)
  return sessionFromToken({
    user: {
      id: token.userId,
      name: token.name ?? null,
      email: token.email ?? null,
      image: token.picture ?? null,
    },
    expires: typeof token.exp === 'number' ? new Date(token.exp * 1000).toISOString() : '',
  }, token)
}
