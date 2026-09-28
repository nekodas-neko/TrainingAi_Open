import { getToken } from 'next-auth/jwt'
import type { JWT } from 'next-auth/jwt'

/**
 * The session JWT's decrypted claims, read from the request rather than from `auth()`.
 *
 * **Why this exists separately from `auth()` (RV-193).** `auth()` returns what
 * `authConfig.callbacks.session` built, and that object is what `GET /api/auth/session` hands to
 * page JavaScript. So a claim the server needs but the browser must not see cannot travel that way
 * — the Google refresh token was doing exactly that, long-lived, able to write to the calendar, and
 * outliving sign-out. It lives in the encrypted httpOnly cookie, which is the right place; this is
 * how a server route reads it back.
 *
 * `secureCookie` is not cosmetic: Auth.js derives the decryption salt from the cookie NAME, so the
 * wrong value derives a different key and every valid token reads as invalid. This matches
 * `bearer-session.ts` and what `app/api/auth/exchange-mobile-token/route.ts` writes — one
 * convention, three places, and it is the thing to change together if it ever moves.
 *
 * Returns null rather than throwing on a missing, malformed, re-signed or expired token.
 */
export async function sessionTokenFrom(headers: Headers): Promise<JWT | null> {
  return (await getToken({
    req: { headers },
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  })) as JWT | null
}

/**
 * The caller's Google refresh token, or null when they never granted calendar access.
 *
 * Null is an authorisation answer, not an error: the calendar route has always treated "no refresh
 * token" as 401, and a signed-in user who declined the scope is exactly that case.
 */
export async function googleRefreshTokenFrom(headers: Headers): Promise<string | null> {
  const token = await sessionTokenFrom(headers)
  return typeof token?.refreshToken === 'string' && token.refreshToken.length > 0
    ? token.refreshToken
    : null
}
