import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

/**
 * The scale readings this account has not filed: the ones waiting to be asked about, and the ones
 * it declined.
 *
 * `pending` is a reading the band could not separate — the owner's partner also uses the physical
 * scale, so a weight unlike this account's usual one waits here for a Confirm/Dismiss instead of
 * auto-saving.
 *
 * `dismissed` is LA-108, and it is a recovery path rather than a history view. A declined reading
 * is un-attributed rather than destroyed, but it had no read path at all, which made every decline
 * final — including one made by a mis-tap. That matters more than it sounds, because the band
 * anchors on the last CONFIRMED weight: with nothing to re-anchor it, a genuine change large enough
 * to be declined once is declined every time after, and nothing on any screen says so.
 * `POST /api/scale-ble/pending/<id>/confirm` accepts one of these, which is what breaks the loop.
 */
const RECENT_DISMISSED_LIMIT = 10

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const [pending, dismissed] = await Promise.all([
    repo.listPendingScaleSamples(session.user.id),
    repo.listRecentDismissedScaleSamples(session.user.id, RECENT_DISMISSED_LIMIT),
  ])
  const shape = (p: { id: number; measuredAt: Date; decoded: Record<string, unknown> | null }) => ({
    id: p.id,
    measuredAt: p.measuredAt.toISOString(),
    weightKg: (p.decoded as { weightKg?: number } | null)?.weightKg ?? null,
  })
  return NextResponse.json({
    pending: pending.map(shape),
    dismissed: dismissed.map(shape),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
