import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'

// Today's confirmed scale readings, oldest first. The trend value is the day's **lowest** reading,
// not the first (Q-69) — so which row carries the badge is resolved by matching the value actually
// stored in body_metrics, never by position. `isTrend: i === 0` was correct only while first-wins
// held; left in place it would have pointed the badge at the wrong row the first time a lower
// second reading replaced an earlier one.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const user = await repo.getUserById(session.user.id)
  const tz = user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const [readings, trend] = await Promise.all([
    repo.listConfirmedScaleSamplesForDate(session.user.id, today, tz),
    repo.getConfirmedScaleTrendForDate(session.user.id, today),
  ])

  // Match on the stored value, and mark at most one row: two readings can legitimately tie on
  // weight, and badging both would say the trend came from two places. First match wins, which is
  // the earlier reading — the one that actually set it.
  let trendMarked = false
  return NextResponse.json({
    readings: readings.map(r => {
      const w = (r.decoded as { weightKg?: number } | null)?.weightKg
      const isTrend = !trendMarked && trend != null && w != null && Math.abs(w - trend.weightKg) < 0.05
      if (isTrend) trendMarked = true
      return {
        id: r.id,
        measuredAt: r.measuredAt.toISOString(),
        isTrend,
        ...(r.decoded as Record<string, unknown> | null ?? {}),
      }
    }),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
