import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@trainingai/shared/date-utils'
import { computeRunningBests } from '@trainingai/shared/health/cardio-trends'

// ~3 years — there's no dedicated unbounded "all activity logs ever" query, so this
// stands in for "all-time" without adding one.
const RUN_LOOKBACK_DAYS = 1095

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:running-bests`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - RUN_LOOKBACK_DAYS * 86_400_000), tz)

  const logs = await repo.listActivityLogs(userId, from, today).catch(() => [])
  const runLogs = logs.filter((l) => l.activityType === 'run')

  return NextResponse.json(computeRunningBests(runLogs), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
