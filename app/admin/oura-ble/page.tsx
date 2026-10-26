import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { OuraBleDebug } from '@/components/oura-ble/oura-ble-debug'
import { StressBackfillConsole } from '@/components/oura-ble/stress-backfill-console'
import { RekeyDeclarationCard } from '@/components/oura-ble/rekey-declaration-card'
import { DbFootprintCard } from '@/components/oura-ble/db-footprint-card'
import { DeviceMetricsPanel } from '@/components/oura-ble/device-metrics-panel'
import { RawStoreStatusConsole } from '@/components/oura-ble/raw-store-status-console'
import { BottomNav } from '@/components/shell/bottom-nav'
import { ConsoleSection } from '@/components/admin/console-section'

export default async function OuraBlePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-1 text-lg font-semibold">Oura Ring — direct BLE</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          In the order §4 of the operations runbook uses: drain the ring, then confirm what landed. Everything below step&nbsp;2 needs the APK — the
          plugin is not in the browser.
        </p>

        {/* Q-544 — these two read only `/api/oura-ble/*` and touch no plugin, so they render on a
            desktop, and they MUST stay above <OuraBleDebug />: inside that component they were
            reachable only from the APK, which is the one client VACUUM FULL's ACCESS EXCLUSIVE lock
            blocks, and unreachable at all while the APK is broken or mid-rebuild — exactly when a
            full volume is most likely. Keeping them in step 1 preserves that; do not fold them into
            a later section for tidiness. */}
        <ConsoleSection
          step={1}
          title="Before you start"
          when="Both read the server only, so they answer on a desktop — which is the point, since a full disk is most likely exactly when the APK cannot be opened."
        >
          <DbFootprintCard />
          <DeviceMetricsPanel />
        </ConsoleSection>

        <ConsoleSection
          step={2}
          title="Drain & re-sync"
          when="Sync now, or Full re-sync from cursor 0 after a recovery, re-key, decoder change or protocol-touching PR. The drain does not need this screen open and posts a notification when it finishes."
        >
          <OuraBleDebug />
        </ConsoleSection>

        <ConsoleSection
          step={3}
          title="Verify what landed"
          when="Runbook step 3b, and the one that matters most now the device is the primary store: the ring's delivered counts must match the local raw store's, per biometric type and not just the debug tags."
        >
          <RawStoreStatusConsole />
        </ConsoleSection>

        <ConsoleSection
          step={4}
          title="Maintenance & corrections"
          when="All WRITE. A re-key declaration tells the server a restarted ring clock was deliberate rather than a history gap; the stress-bucket backfill adds missing buckets (add-only)."
        >
          <RekeyDeclarationCard />
          <StressBackfillConsole />
        </ConsoleSection>
      </main>
      <BottomNav isAdmin />
    </>
  )
}
