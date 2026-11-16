import type { NextRequest, NextResponse } from 'next/server'

// Every name the session cookie can carry: `__Secure-` in production, and Auth.js splits a large JWT
// into `.0`, `.1`, … chunks.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/
const CANONICAL_SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token'

/**
 * Expire the caller's session cookie on `res`. Used where the session is over for a reason the
 * browser cannot see: the user's own account was deleted (`DELETE /api/account`), or an admin reset
 * their own data (`POST /api/admin/users/reset-data`, #3369). The token is dead on the server either
 * way; this keeps the browser from sending it. Also where the browser's session has done its job:
 * native sign-in's last step (`/mobile-signin/complete`, #3797), whose cookie would otherwise stay
 * signed in, unlisted under Signed-in devices and untouched by revoking the phone.
 *
 * Same name, `path: '/'`, no `Domain` (Auth.js sets none) and the same `HttpOnly`/`SameSite=Lax`/
 * `Secure` flags as Auth.js's own session cookie, so the browser replaces it rather than adding a
 * second one.
 */
export function clearSessionCookies(req: Pick<NextRequest, 'cookies'> | { cookies: { getAll(): { name: string }[] } }, res: NextResponse): void {
  const names = new Set([CANONICAL_SESSION_COOKIE, ...req.cookies.getAll().map(c => c.name).filter(n => SESSION_COOKIE.test(n))])
  for (const name of names) {
    // A `__Secure-` cookie can only be overwritten by a Secure Set-Cookie; anything else is ignored.
    res.cookies.set(name, '', {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0,
      secure: name.startsWith('__Secure-') || process.env.NODE_ENV === 'production',
    })
  }
}
