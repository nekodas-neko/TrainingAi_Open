import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { cookies } from 'next/headers';
import { mintMobileBridgeToken } from '@/lib/auth/mobile/bridge';
import { MobileBridgeRedirect } from './redirect-client';
import { nativeReturnUrl, readNativeTransaction } from '@/lib/auth/mobile/native-transaction';

export const dynamic = 'force-dynamic';

export default async function AuthMobileBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; client?: string; state?: string }>;
}) {
  const { challenge, client, state } = await searchParams;
  const cookieStore = await cookies();
  const transaction = client !== undefined ? await readNativeTransaction(cookieStore) : null;
  if (
    client !== undefined &&
    (transaction?.client !== client ||
      !transaction ||
      transaction.challenge !== challenge ||
      transaction.state !== state)
  ) {
    redirect('/mobile-signin/ios');
  }
  const session = await auth();
  if (!session?.user?.id) {
    if (transaction) {
      return (
        <MobileBridgeRedirect
          returnUrl={nativeReturnUrl(transaction, { error: 'authentication_failed' })}
        />
      );
    }
    redirect('/sign-in');
  }

  const token = mintMobileBridgeToken(challenge, cookieStore);
  if (!token) redirect('/sign-in');
  const returnUrl = transaction
    ? nativeReturnUrl(transaction, { token })
    : `trainingai://auth-complete?token=${token}`;
  return <MobileBridgeRedirect returnUrl={returnUrl} />;
}
