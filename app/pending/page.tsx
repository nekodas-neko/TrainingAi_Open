import { Meteors } from '@/components/ui/meteors'
import { Clock } from 'lucide-react'
import Link from 'next/link'

export default function PendingPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <Meteors number={30} />

      <div className="relative z-10 w-full max-w-md space-y-8 p-8 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">TrainingAI</h1>
        </div>

        <div className="space-y-6 rounded-xl border bg-card/50 p-8 shadow-xl backdrop-blur-sm">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30">
              <Clock className="h-8 w-8" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Awaiting approval</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your account has been registered. Access will be granted once an admin approves it — usually within a day.
            </p>
          </div>
          <Link href="/sign-in" className="block text-sm underline underline-offset-4 text-muted-foreground">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
