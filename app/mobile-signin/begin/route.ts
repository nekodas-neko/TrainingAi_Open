import { NextRequest, NextResponse } from 'next/server'
import { PKCE_CHALLENGE_RE } from '@/lib/auth/mobile/pkce'
import { MOBILE_CHALLENGE_COOKIE, MOBILE_CHALLENGE_MAX_AGE_S } from '@/lib/auth/mobile/challenge-cookie'
import { MOBILE_RETURN_SCHEME_COOKIE, PRODUCTION_RETURN_SCHEME, RETURN_SCHEME_PARAM, acceptReturnScheme } from '@/lib/auth/mobile/return-scheme'
import { IOS_STATE_RE, IOS_TRANSACTION_COOKIE, IOS_TRANSACTION_MAX_AGE, signIosTransaction } from '@/lib/auth/mobile/ios-transaction'

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? ''
  const client = req.nextUrl.searchParams.get('client')
  const state = req.nextUrl.searchParams.get('state') ?? ''
  const isProduction = process.env.NODE_ENV === 'production'
  const returnParam = req.nextUrl.searchParams.get(RETURN_SCHEME_PARAM)
  // The return scheme is for the Android apps only. One the allow-list does not name is refused,
  // never echoed (lib/auth/mobile/return-scheme.ts).
  const returnScheme = client === null ? acceptReturnScheme(returnParam, isProduction) : null
  if ((client !== null && client !== 'ios') || (client === 'ios' && !IOS_STATE_RE.test(state))
    || (client === 'ios' && returnParam !== null)) {
    return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 })
  }
  if (!PKCE_CHALLENGE_RE.test(challenge) || (client === null && returnScheme === null)) {
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
  // Production never sees a Dev return and keeps its exact old response.
  if (!isProduction) {
    if (returnScheme && returnScheme !== PRODUCTION_RETURN_SCHEME) {
      res.cookies.set(MOBILE_RETURN_SCHEME_COOKIE, returnScheme, {
        httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: MOBILE_CHALLENGE_MAX_AGE_S,
      })
    } else {
      res.cookies.delete(MOBILE_RETURN_SCHEME_COOKIE)
    }
  }
  res.cookies.set(MOBILE_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MOBILE_CHALLENGE_MAX_AGE_S,
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
