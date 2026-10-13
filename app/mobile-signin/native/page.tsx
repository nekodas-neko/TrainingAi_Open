import { NativeConsentForm } from './consent-form';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { auth } from '@/auth';
import { NativeLoginForm } from './login-form';
import { MobileBridgeRedirect } from '@/app/auth-mobile-bridge/redirect-client';
import {
  nativeBridgePath,
  nativeReturnUrl,
  readNativeTransaction,
  nativeSignInPath,
  signNativeConsent,
  NATIVE_CONSENT_COOKIE,
} from '@/lib/auth/mobile/native-transaction';

export const dynamic = 'force-dynamic';

export default async function NativeSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const transaction = await readNativeTransaction(await cookies());
  if (!transaction) {
    return (
      <main className="p-8">
        <h1>Sign-in expired</h1>
        <p>Close this window and start sign-in again from the mobile app.</p>
      </main>
    );
  }
  const { error } = await searchParams;
  if (error) {
    return (
      <MobileBridgeRedirect
        returnUrl={nativeReturnUrl(transaction, {
          error: error === 'account_pending' ? 'account_pending' : 'authentication_failed',
        })}
      />
    );
  }
  const callbackUrl = nativeBridgePath(transaction);
  const session = await auth();
  if (session?.user?.id) {
    async function continueSignIn() {
      'use server';
      const store = await cookies();
      const current = await readNativeTransaction(store);
      const account = await auth();
      if (
        !current ||
        current.state !== transaction!.state ||
        current.challenge !== transaction!.challenge ||
        account?.user?.id !== session!.user.id
      ) {
        return null;
      }
      store.set(NATIVE_CONSENT_COOKIE, await signNativeConsent(current, account!.user.id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300,
      });
      return nativeBridgePath(current);
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-2xl font-semibold">
            Continue as {session.user.name || session.user.email}?
          </h1>
          <p>
            Allow the TrainingAi{' '}
            {transaction.client === 'android-dev'
              ? 'Android development'
              : transaction.client === 'ios'
                ? 'iPhone'
                : 'Android'}{' '}
            app to use this account.
          </p>
          <NativeConsentForm action={continueSignIn} />
          <Link className="block text-center underline" href="/">
            Cancel
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-md space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Sign in to TrainingAI</h1>
        <p className="text-muted-foreground">
          Continue with your existing account to return to the mobile app.
        </p>
        <NativeLoginForm
          callbackUrl={callbackUrl}
          state={transaction.state}
          signInPath={nativeSignInPath(transaction)}
        />
      </div>
    </main>
  );
}
