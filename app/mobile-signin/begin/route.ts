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
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  const res =
    client !== null
      ? new NextResponse(null, {
          status: 307,
          headers: {
            Location: client === 'ios' ? '/mobile-signin/ios' : '/mobile-signin/native',
          },
        })
      : NextResponse.redirect(new URL(`/mobile-signin?challenge=${challenge}`, req.url));
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
