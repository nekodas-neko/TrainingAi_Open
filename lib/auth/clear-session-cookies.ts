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
 * way; this keeps the browser from sending it.
 */
export function clearSessionCookies(req: NextRequest, res: NextResponse): void {
  const names = new Set([CANONICAL_SESSION_COOKIE, ...req.cookies.getAll().map(c => c.name).filter(n => SESSION_COOKIE.test(n))])
  for (const name of names) {
    // A `__Secure-` cookie can only be overwritten by a Secure Set-Cookie; anything else is ignored.
    res.cookies.set(name, '', {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0,
      secure: name.startsWith('__Secure-') || process.env.NODE_ENV === 'production',
    })
  }
}
