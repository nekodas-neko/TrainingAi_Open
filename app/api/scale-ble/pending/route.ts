import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

// Lists weigh-ins staged as 'pending' by the anomaly check in /api/scale-ble/samples — the
// owner's partner also uses the physical scale, so a reading that looks like a big jump from
// the account's usual weight waits here for a Confirm/Dismiss instead of auto-saving.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const pending = await repo.listPendingScaleSamples(session.user.id)
  return NextResponse.json({
    pending: pending.map(p => ({
      id: p.id,
      measuredAt: p.measuredAt.toISOString(),
      weightKg: (p.decoded as { weightKg?: number } | null)?.weightKg ?? null,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
