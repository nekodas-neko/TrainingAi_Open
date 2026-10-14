import { NextRequest, NextResponse } from 'next/server';
import { PKCE_CHALLENGE_RE } from '@/lib/auth/mobile/pkce';
import {
  MOBILE_CHALLENGE_COOKIE,
  MOBILE_CHALLENGE_MAX_AGE_S,
} from '@/lib/auth/mobile/challenge-cookie';
import {
  NATIVE_STATE_RE,
  NATIVE_TRANSACTION_COOKIE,
  NATIVE_TRANSACTION_MAX_AGE,
  signNativeTransaction,
  isNativeClient,
} from '@/lib/auth/mobile/native-transaction';

// Relative Locations, never `new URL(path, req.url)`: behind Railway's proxy a route handler's
// `req.url` is the container's own address, so production sent the Android sign-in tab to
// https://localhost:8080/mobile-signin and a fresh Google sign-in could not start.
const redirectTo = (path: string) =>
  new NextResponse(null, { status: 307, headers: { Location: path } });

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('challenge') ?? '';
  const client = req.nextUrl.searchParams.get('client');
  if (
    ['client', 'challenge', 'state'].some(
      (key) => req.nextUrl.searchParams.getAll(key).length > 1,
    )
  )
    return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 });
  const state = req.nextUrl.searchParams.get('state') ?? '';
  if (
    (client !== null && !isNativeClient(client)) ||
    (client !== null && !NATIVE_STATE_RE.test(state))
  ) {
    return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 });
  }
  if (!PKCE_CHALLENGE_RE.test(challenge)) {
    if (client !== null) {
      return NextResponse.json({ error: 'Invalid mobile transaction' }, { status: 400 });
    }
    return redirectTo('/sign-in');
  }
  const res = redirectTo(
    client === null
      ? `/mobile-signin?challenge=${challenge}`
      : client === 'ios'
        ? '/mobile-signin/ios'
        : '/mobile-signin/native',
  );
  if (client !== null) {
    res.cookies.set(
      NATIVE_TRANSACTION_COOKIE,
      await signNativeTransaction({ client, challenge, state }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: NATIVE_TRANSACTION_MAX_AGE,
      },
    );
  } else {
    res.cookies.delete(NATIVE_TRANSACTION_COOKIE);
  }
  res.cookies.set(MOBILE_CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MOBILE_CHALLENGE_MAX_AGE_S,
  });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
