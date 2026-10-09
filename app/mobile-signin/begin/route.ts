import { NextRequest, NextResponse } from 'next/server'
import { PKCE_CHALLENGE_RE } from '@/lib/auth/mobile/pkce'
import { MOBILE_CHALLENGE_COOKIE, MOBILE_CHALLENGE_MAX_AGE_S } from '@/lib/auth/mobile/challenge-cookie'
import { IOS_STATE_RE, IOS_TRANSACTION_COOKIE, IOS_TRANSACTION_MAX_AGE, signIosTransaction } from '@/lib/auth/mobile/ios-transaction'

// Relative Locations, never `new URL(path, req.url)`: behind Railway's proxy a route handler's
// `req.url` is the container's own address, so production sent the Android sign-in tab to
// https://localhost:8080/mobile-signin and a fresh Google sign-in could not start.
const redirectTo = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } })

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
    return redirectTo('/sign-in')
  }
  const res = redirectTo(client === 'ios' ? '/mobile-signin/ios' : `/mobile-signin?challenge=${challenge}`)
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
    sameSite: 'lax',
    path: '/',
    maxAge: MOBILE_CHALLENGE_MAX_AGE_S,
  })
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
