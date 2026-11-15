import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { mintMobileBridgeToken } from '@/lib/auth/mobile/bridge';
import { MOBILE_CHALLENGE_COOKIE } from '@/lib/auth/mobile/challenge-cookie';
import { clearSessionCookies } from '@/lib/auth/clear-session-cookies';
import {
  hasNativeConsent,
  nativeReturnUrl,
  readNativeTransaction,
  NATIVE_CONSENT_COOKIE,
  NATIVE_TRANSACTION_COOKIE,
} from '@/lib/auth/mobile/native-transaction';
export async function GET() {
  const store = await cookies();
  const transaction = await readNativeTransaction(store);
  const session = await auth();
  if (
    !transaction ||
    !session?.user?.id ||
    !(await hasNativeConsent(store, transaction, session.user.id))
  )
    return NextResponse.json({ error: 'Sign-in confirmation required' }, { status: 401 });
  const token = mintMobileBridgeToken(transaction.challenge, store);
  if (!token) return NextResponse.json({ error: 'Sign-in expired' }, { status: 401 });
  const response = NextResponse.redirect(nativeReturnUrl(transaction, { token }));
  for (const name of [
    NATIVE_TRANSACTION_COOKIE,
    MOBILE_CHALLENGE_COOKIE,
    NATIVE_CONSENT_COOKIE,
  ])
    response.cookies.delete(name);
  // #3797: the browser's session was only the way to this bridge code; the code already carries its
  // value (`mintMobileBridgeToken`). Left in place it stays signed in to the web app on the phone's
  // browser, is not listed under Signed-in devices, and revoking the phone does not end it.
  // `auth()` above re-issues the cookie (Auth.js slides its expiry), and Next sends that Set-Cookie
  // ahead of the response's own; a browser applies them in order (RFC 6265 §5.3), so this deletion,
  // last, is what sticks. Checked on `pnpm dev`: the next request carries no session.
  clearSessionCookies({ cookies: store }, response);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
