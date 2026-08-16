import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { bucketZoneMinutesByWeek, buildEfficiencyCurve, buildCadenceTrend } from '@trainingai/shared/health/cardio-trends'

const ZONE_WEEKS = 8
const RUN_LOOKBACK_DAYS = 90

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:cardio-trends`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const zoneFrom = toAestDay(new Date(todayMidnightUtc(tz).getTime() - ZONE_WEEKS * 7 * 86_400_000), tz)
  const runFrom = toAestDay(new Date(todayMidnightUtc(tz).getTime() - RUN_LOOKBACK_DAYS * 86_400_000), tz)

  const profile = await resolveHrProfile(repo, userId, tz)

  const [days, logs] = await Promise.all([
    repo.getZoneMinutesRange(userId, zoneFrom, today, tz, profile).catch(() => []),
    repo.listActivityLogs(userId, runFrom, today).catch(() => []),
  ])

  const runLogs = logs.filter((l) => l.activityType === 'run')

  return NextResponse.json(
    {
      weeklyZoneStacks: bucketZoneMinutesByWeek(days),
      efficiencyCurve: buildEfficiencyCurve(runLogs),
      cadenceTrend: buildCadenceTrend(runLogs),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
