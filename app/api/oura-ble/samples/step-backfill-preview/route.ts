import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { reportServerError } from '@/lib/observability'

// Read-only dry-run for the D0 historical step backfill (`?allowStepsDecrease=1` on the redecode
// route) — computes exactly what would change, writes nothing, so the owner can review the real
// scope before firing the destructive rewrite. Admin-gated; safe to run repeatedly.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!rateLimit(`oura-ble-step-backfill-preview:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const tz = session.user.timezone ?? DEFAULT_TZ

  try {
    const rows = await repo.previewStepsBackfill(userId, tz)
    const totalOldSteps = rows.reduce((sum, r) => sum + r.oldSteps, 0)
    const totalNewSteps = rows.reduce((sum, r) => sum + r.newSteps, 0)
    return NextResponse.json({
      affectedDays: rows.length,
      totalOldSteps,
      totalNewSteps,
      rows,
    })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/oura-ble/samples/step-backfill-preview' })
    console.error('[oura-ble] step-backfill preview failed:', err)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
