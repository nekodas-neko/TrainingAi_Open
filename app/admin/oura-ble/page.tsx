import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { OuraBleDebug } from '@/components/oura-ble/oura-ble-debug'
import { LiveHrTestConsole } from '@/components/oura-ble/live-hr-test-console'
import { SleepNetDumpConsole } from '@/components/oura-ble/sleepnet-dump-console'
import { WorkoutSensorProbeConsole } from '@/components/oura-ble/workout-sensor-probe-console'
import { DaytimeCoverageConsole } from '@/components/oura-ble/daytime-coverage-console'
import { StepCounterExportConsole } from '@/components/oura-ble/step-counter-export-console'
import { StepBackfillConsole } from '@/components/oura-ble/step-backfill-console'
import { RingBatteryConsole } from '@/components/oura-ble/ring-battery-console'
import { ComparisonHarnessConsole } from '@/components/oura-ble/comparison-harness-console'
import { RawStoreStatusConsole } from '@/components/oura-ble/raw-store-status-console'
import { DhrvComparisonConsole } from '@/components/oura-ble/dhrv-comparison-console'
import { BottomNav } from '@/components/shell/bottom-nav'

export default async function OuraBlePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-4 text-lg font-semibold">Oura Ring — direct BLE</h1>
        <OuraBleDebug />
        <div className="mt-4">
          <RawStoreStatusConsole />
        </div>
        <div className="mt-4">
          <SleepNetDumpConsole />
        </div>
        <div className="mt-4">
          <WorkoutSensorProbeConsole />
        </div>
        <div className="mt-4">
          <DaytimeCoverageConsole />
        </div>
        <div className="mt-4">
          <StepCounterExportConsole />
        </div>
        <div className="mt-4">
          <StepBackfillConsole />
        </div>
        <div className="mt-4">
          <RingBatteryConsole />
        </div>
        <div className="mt-4">
          <LiveHrTestConsole />
        </div>
        <div className="mt-4">
          <ComparisonHarnessConsole />
        </div>
        <div className="mt-4">
          <DhrvComparisonConsole />
        </div>
      </main>
      <BottomNav isAdmin />
    </>
  )
}
