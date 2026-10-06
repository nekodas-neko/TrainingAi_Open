import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { IosLoginForm } from './login-form'
import { MobileBridgeRedirect } from '@/app/auth-mobile-bridge/redirect-client'
import { iosBridgePath, iosReturnUrl, readIosTransaction } from '@/lib/mobile-ios-transaction'

export const dynamic = 'force-dynamic'

export default async function IosSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const transaction = await readIosTransaction(await cookies())
  if (!transaction) {
    return <main className="p-8"><h1>Sign-in expired</h1><p>Close this window and start sign-in again from the iPhone app.</p></main>
  }
  const { error } = await searchParams
  if (error) {
    return <MobileBridgeRedirect returnUrl={iosReturnUrl(transaction, {
      error: error === 'account_pending' ? 'account_pending' : 'authentication_failed',
    })} />
  }
  const callbackUrl = iosBridgePath(transaction)
  const session = await auth()
  if (session?.user?.id) {
    redirect(callbackUrl)
  }
  return <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
    <div className="w-full max-w-md space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in to TrainingAI</h1>
      <p className="text-muted-foreground">Continue with your existing account to return to the iPhone app.</p>
      <IosLoginForm callbackUrl={callbackUrl} state={transaction.state} />
    </div>
  </main>
}
