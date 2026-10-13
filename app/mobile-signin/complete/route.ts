import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { mintMobileBridgeToken } from '@/lib/auth/mobile/bridge';
import { MOBILE_CHALLENGE_COOKIE } from '@/lib/auth/mobile/challenge-cookie';
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
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
