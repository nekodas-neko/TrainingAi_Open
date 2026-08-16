import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { aggregateExerciseHrTrend } from '@trainingai/shared/workout/exercise-hr-trend'
import { DEFAULT_TZ, todayMidnightUtc } from '@trainingai/shared/date-utils'

// Per-exercise HR trend (plan 2026-07-21-per-set-hr-metrics) — reads the durable per-set snapshots
// (set_hr_stats) for one exercise over a trailing window and rolls them up to per-session points +
// an intensity-band breakdown. Match by exerciseId when known, else the denormalised name.
const MAX_DAYS = 730
const DEFAULT_DAYS = 180

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:exercise-hr-trend`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const exerciseId = req.nextUrl.searchParams.get('exerciseId')
  const exerciseName = req.nextUrl.searchParams.get('exerciseName') ?? undefined
  if (!exerciseId && !exerciseName) {
    return NextResponse.json({ error: 'Missing exerciseId or exerciseName' }, { status: 400 })
  }

  const daysParam = Number(req.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.round(daysParam), MAX_DAYS) : DEFAULT_DAYS
  // Anchored at the user's local midnight, not `Date.now() - N days`: a raw ms offset straddles
  // two local days and merges them into one bucket (the banned pattern, session 62 / Q-130).
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const since = new Date(todayMidnightUtc(tz).getTime() - days * 86_400_000)

  const repo = await getRepository()
  const rows = await repo.getSetHrStatsForExercise(userId, { exerciseId, exerciseName, since })
  const trend = aggregateExerciseHrTrend(rows)

  return NextResponse.json(trend, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
