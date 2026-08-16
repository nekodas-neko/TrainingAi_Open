import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isAdminUser } from '@/lib/admin'
import { DataCaptureConsole } from '@/components/admin/data-capture-console'
import { BottomNav } from '@/components/shell/bottom-nav'

// Admin-only device-data capture panel: run every probe (server routes + native BLE),
// collect a copyable JSON snapshot with per-probe failure causes. Built to be run on the
// S25 APK where the native probes actually return data.
export default async function DataCapturePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  if (!await isAdminUser(session.user.id, session.user.isAdmin)) redirect('/')

  return (
    <>
      <main className="pt-safe-or-4 mx-auto max-w-lg px-4 pb-24">
        <h1 className="mb-1 text-lg font-semibold">Device data capture</h1>
        <p className="mb-4 text-xs text-[color:var(--muted-foreground)]">
          Run this on the phone (APK) to snapshot the on-device data + any capture failures, then copy the
          JSON out.
        </p>
        <DataCaptureConsole />
      </main>
      <BottomNav isAdmin />
    </>
  )
}
