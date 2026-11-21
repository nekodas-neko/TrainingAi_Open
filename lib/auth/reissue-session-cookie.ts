import { encode, getToken } from 'next-auth/jwt'
import type { NextRequest, NextResponse } from 'next/server'
import { SESSION_MAX_AGE_SECONDS } from './session'
import { clearSessionCookies } from './clear-session-cookies'

// Auth.js's own limits (`@auth/core/lib/utils/cookie.js`): a value over 3936 characters is split into
// `<name>.0`, `<name>.1`, … and read back by joining them in order.
const CHUNK_SIZE = 4096 - 160

const secureCookie = () => process.env.NODE_ENV === 'production'
const cookieName = () => (secureCookie() ? '__Secure-authjs.session-token' : 'authjs.session-token')

/**
 * #3673 item 5: give the browser that just changed the password a session stamped after the
 * account's new sign-in cut-off, so it stays signed in while every other session is refused.
 *
 * The new cookie is the request's own session, decoded and re-encoded unchanged except for a fresh
 * `signedInAt` (and the expiry and ids `encode` sets). The stamp is the caller's, read from the
 * database clock after the change committed, so it is at or after the new cut-off; the cookie is
 * renewed only when it decodes to `expectedUserId`. Nothing from the request body reaches it, and
 * it is only ever called after the caller proved the current password (or a fresh sign-in, for a
 * first one) and the change committed. A request without a readable web session cookie (a bearer
 * caller, a missing secret) gets no cookie and false: its own sign-in ended with the others.
 *
 * Every session cookie the browser holds is expired first (`clearSessionCookies`), so a shorter
 * value never leaves a stale `.1` chunk behind, then the new one is set with the flags Auth.js uses:
 * HttpOnly, SameSite=Lax, path `/`, Secure in production, and the session's usual lifetime.
 *
 * Not reachable from `/api/auth/session`'s update: that takes client-supplied data, so the jwt
 * callback never re-stamps `signedInAt` and a client cannot move itself past a cut-off.
 */
export async function reissueSessionCookie(
  req: NextRequest,
  res: NextResponse,
  /** The user the route authenticated (`auth()`); the cookie must be theirs, or nothing is issued. */
  expectedUserId: string,
  /** The new `signedInAt`, read after the change committed (`signInStampFor`, database clock). */
  signedInAt: number,
): Promise<boolean> {
  const secret = process.env.AUTH_SECRET
  if (!secret) return false
  const name = cookieName()
  let token: Awaited<ReturnType<typeof getToken>>
  try {
    token = await getToken({ req: { headers: req.headers }, secret, secureCookie: secureCookie() })
  } catch {
    return false
  }
  if (!token || typeof token.userId !== 'string') return false
  // #3949 review N2: only the session the route authenticated is renewed. A request whose cookie
  // decodes to someone else (a bearer caller with a stray cookie, two sessions in one browser)
  // gets nothing, so this can never mint a fresh session for an account that did not change its
  // password.
  if (token.userId !== expectedUserId) return false
  if (!Number.isSafeInteger(signedInAt)) return false
  const { iat: _iat, exp: _exp, jti: _jti, ...claims } = token
  const value = await encode({
    secret,
    salt: name,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: { ...claims, signedInAt },
  })
  clearSessionCookies(req, res)
  const options = {
    httpOnly: true, sameSite: 'lax' as const, path: '/', secure: secureCookie(), maxAge: SESSION_MAX_AGE_SECONDS,
  }
  const count = Math.ceil(value.length / CHUNK_SIZE)
  if (count <= 1) {
    res.cookies.set(name, value, options)
  } else {
    for (let i = 0; i < count; i++) res.cookies.set(`${name}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), options)
  }
  return true
}
