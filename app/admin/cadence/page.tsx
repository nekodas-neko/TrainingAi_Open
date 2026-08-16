import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { CadenceCalibrationConsole } from '@/components/cadence/cadence-calibration-console'
import { BottomNav } from '@/components/shell/bottom-nav'

export default async function CadenceCalibrationPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-1 text-lg font-semibold">Cadence calibration</h1>
        <p className="mb-4 text-xs text-muted-foreground">
          Compares the ring and the chest strap against a treadmill&apos;s displayed cadence.
          Both sources need a live BLE connection, so this only produces readings on the APK.
        </p>
        <CadenceCalibrationConsole />
      </main>
      <BottomNav isAdmin />
    </>
  )
}
