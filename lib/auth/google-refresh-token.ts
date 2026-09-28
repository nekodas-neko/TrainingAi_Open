import { getToken } from 'next-auth/jwt'

/**
 * The signed-in user's Google refresh token, read from the encrypted session JWT on the server.
 *
 * RV-193. It used to be copied onto `session.refreshToken`, which `GET /api/auth/session` returns to
 * page JavaScript. That exposed a long-lived token with Calendar write access to any script
 * running in the app's origin, and it outlived sign-out. Its only consumer is a server route, so
 * it never needed to leave the JWT.
 *
 * Same `getToken` call as `bearer-session.ts`, including the `secureCookie` salt, for the reason
 * given there: the wrong cookie name derives a different key and every token reads as invalid.
 * Returns the token only when the JWT belongs to `userId`, so a caller cannot pair one user's
 * session with another's token.
 */
export async function googleRefreshTokenFor(headers: Headers, userId: string): Promise<string | null> {
  const token = await getToken({
    req: { headers },
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  })
  if (!token || token.userId !== userId) return null
  return typeof token.refreshToken === 'string' && token.refreshToken ? token.refreshToken : null
}
