import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { mintMobileBridgeToken } from "@/lib/mobile-auth-bridge";
import { MobileBridgeRedirect } from "./redirect-client";
import { iosReturnUrl, readIosTransaction } from '@/lib/mobile-ios-transaction';

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

  // Render a client component that uses window.location.href — the only
  // reliable way to fire a custom URL scheme from a Chrome Custom Tab.
  return transaction ? <MobileBridgeRedirect returnUrl={iosReturnUrl(transaction, { token })} /> : <MobileBridgeRedirect token={token} />;
}
