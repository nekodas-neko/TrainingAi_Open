import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

// Admin feasibility probe: per-tag hour-of-day coverage of raw BLE samples over the last N days.
// Answers whether the ring streams daytime motion/temp/MET when worn-idle (the gate on the
// daytime-signal model builds: steps, activity-detection, awake-HR, daytime stress) or only
// captures around sleep. Read-only.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rateLimit(`oura-ble-daytime-coverage:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const daysParam = Number(new URL(req.url).searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7
  const tz = session.user.timezone ?? DEFAULT_TZ

  const repo = await getRepositoryAsync()
  const coverage = await repo.getDaytimeTagCoverage(userId, tz, days)
  return NextResponse.json(coverage)
}
