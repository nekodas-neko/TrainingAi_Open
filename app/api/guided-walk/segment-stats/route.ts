import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@trainingai/shared/date-utils'
import { aggregateSegmentsByKind, type WalkSegmentStat } from '@/lib/walk/segment-stats'

// ~3 years — mirrors running-bests' lookback; there's no dedicated unbounded
// "all activity logs ever" query, so this stands in for "all-time".
const WALK_LOOKBACK_DAYS = 1095

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:walk-segment-stats`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - WALK_LOOKBACK_DAYS * 86_400_000), tz)

  const logs = await repo.listActivityLogs(userId, from, today).catch(() => [])
  // Treadmill interval walks count too (Q-66). They are the same workout done indoors, and
  // `aggregateSegmentsByKind` already filters nulls per field — so a treadmill segment contributes
  // its real heart rate and contributes nothing at all to the pace and distance averages. Filtering
  // them out here instead would silently drop the owner's indoor walks from the fast/slow card they
  // are doing the intervals for.
  const allSegments = logs
    .filter((l) => (l.activityType === 'walk' || l.activityType === 'treadmill') && l.segments != null)
    .flatMap((l) => l.segments as WalkSegmentStat[])

  return NextResponse.json(aggregateSegmentsByKind(allSegments), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
