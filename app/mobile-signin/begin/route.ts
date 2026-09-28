import { NextRequest, NextResponse } from 'next/server'
import { PKCE_CHALLENGE_RE } from '@/lib/pkce'
import { MOBILE_CHALLENGE_COOKIE, MOBILE_CHALLENGE_MAX_AGE_S } from '@/lib/mobile-auth-challenge-cookie'

/**
 * The first stop of the APK's Google sign-in (RV-195 ①): remember the challenge in an httpOnly
 * cookie on this tab, then continue to `/mobile-signin`, which starts the Google flow. The bridge
 * at the end refuses a challenge this cookie does not hold.
 */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? ''
  if (!PKCE_CHALLENGE_RE.test(challenge)) {
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }
  const res = NextResponse.redirect(new URL(`/mobile-signin?challenge=${challenge}`, req.url))
  res.cookies.set(MOBILE_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: the tab comes back from Google as a cross-site top-level GET, which Lax allows.
    sameSite: 'lax',
    path: '/',
    maxAge: MOBILE_CHALLENGE_MAX_AGE_S,
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
