import { NextRequest, NextResponse } from 'next/server'
import { PKCE_CHALLENGE_RE } from '@/lib/pkce'
import { MOBILE_CHALLENGE_COOKIE, MOBILE_CHALLENGE_MAX_AGE_S } from '@/lib/mobile-auth-challenge-cookie'
import { IOS_STATE_RE, IOS_TRANSACTION_COOKIE, IOS_TRANSACTION_MAX_AGE, signIosTransaction } from '@/lib/mobile-ios-transaction'

/**
 * The first stop of the APK's Google sign-in (RV-195 ①): remember the challenge in an httpOnly
 * cookie on this tab, then continue to `/mobile-signin`, which starts the Google flow. The bridge
 * at the end refuses a challenge this cookie does not hold.
 */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? ''
  const client = req.nextUrl.searchParams.get('client')
  const state = req.nextUrl.searchParams.get('state') ?? ''
  if ((client !== null && client !== 'ios') || (client === 'ios' && !IOS_STATE_RE.test(state))) {
    return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 })
  }
  if (!PKCE_CHALLENGE_RE.test(challenge)) {
    if (client === 'ios') {
      return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 })
    }
    return NextResponse.redirect(new URL('/sign-in', req.url))
  }
  const res = client === 'ios'
    ? new NextResponse(null, { status: 307, headers: { Location: '/mobile-signin/ios' } })
    : NextResponse.redirect(new URL(`/mobile-signin?challenge=${challenge}`, req.url))
  if (client === 'ios') {
    res.cookies.set(IOS_TRANSACTION_COOKIE, await signIosTransaction({ challenge, state }), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/', maxAge: IOS_TRANSACTION_MAX_AGE,
    })
  } else {
    res.cookies.delete(IOS_TRANSACTION_COOKIE)
  }
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
