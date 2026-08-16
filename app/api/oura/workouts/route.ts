import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import {
  MIN_DISTANCE_M, MIN_AVG_SPEED_KMH, MIN_DURATION_SEC, MAX_DURATION_SEC,
} from '@/lib/activity/detection-thresholds'

// Oura activity strings that map to walk or run
const WALK_RUN_ACTIVITIES = new Set([
  'walking', 'running', 'walk', 'run', 'outdoor_walk', 'outdoor_run',
  'treadmill_walking', 'treadmill_running',
])

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const unreviewed = req.nextUrl.searchParams.get('unreviewed') === 'true'
  const repo = await getRepository()
  const all = await repo.getOuraWorkouts(session.user.id, { unreviewed, timezone: session.user.timezone })
  const relevant = all.filter(w => {
    if (!WALK_RUN_ACTIVITIES.has(w.activity.toLowerCase())) return false
    const durationSec = (w.endDatetime.getTime() - w.startDatetime.getTime()) / 1000
    if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) return false
    if ((w.distanceM ?? 0) < MIN_DISTANCE_M) return false
    const avgSpeedKmh = (w.distanceM! / durationSec) * 3.6
    return avgSpeedKmh >= MIN_AVG_SPEED_KMH
  })

  return NextResponse.json(relevant, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const repo = await getRepository()
  await repo.markOuraWorkoutReviewed(session.user.id, id)
  return NextResponse.json({ ok: true })
}
