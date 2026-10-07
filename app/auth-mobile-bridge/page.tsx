import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { mintMobileBridgeToken } from "@/lib/auth/mobile/bridge";
import { MobileBridgeRedirect } from "./redirect-client";
import { iosReturnUrl, readIosTransaction } from '@/lib/auth/mobile/ios-transaction';
import { MOBILE_RETURN_SCHEME_COOKIE, mobileReturnUrl } from '@/lib/auth/mobile/return-scheme';

export const dynamic = 'force-dynamic';

export default async function AuthMobileBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; client?: string; state?: string }>;
}) {
  const { challenge, client, state } = await searchParams;
  const cookieStore = await cookies();
  const transaction = client === 'ios' ? await readIosTransaction(cookieStore) : null;
  if (client && (client !== 'ios' || !transaction || transaction.challenge !== challenge || transaction.state !== state)) {
    redirect('/mobile-signin/ios');
  }
  const session = await auth();
  if (!session?.user?.id) {
    if (transaction) {
      return <MobileBridgeRedirect returnUrl={iosReturnUrl(transaction, { error: 'authentication_failed' })} />;
    }
    redirect('/sign-in');
  }

  const token = mintMobileBridgeToken(challenge, cookieStore);
  if (!token) redirect("/sign-in");
  const returnUrl = transaction
    ? iosReturnUrl(transaction, { token })
    : mobileReturnUrl(token, cookieStore.get(MOBILE_RETURN_SCHEME_COOKIE)?.value, process.env.NODE_ENV === 'production');
  return <MobileBridgeRedirect returnUrl={returnUrl} />;
}
