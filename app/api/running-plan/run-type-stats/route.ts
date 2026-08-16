import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@trainingai/shared/date-utils'
import { computeRunTypeStats, type CompletedRunForStats } from '@trainingai/shared/running/run-type-stats'

// ~3 years — mirrors running-bests' lookback; there's no dedicated unbounded
// "all activity logs ever" query, so this stands in for "all-time".
const RUN_LOOKBACK_DAYS = 1095

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:run-type-stats`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - RUN_LOOKBACK_DAYS * 86_400_000), tz)

  // Run type is only known for runs completed via the running-plan "prescribed run" flow
  // (prescribed_runs.runType) — a freeform run logged outside that flow has no type
  // recorded anywhere yet, so it can't contribute here (see 2026-07-31 scoping decision).
  const [prescribedRuns, logs] = await Promise.all([
    repo.getPrescribedRuns(userId, from, today).catch(() => []),
    repo.listActivityLogs(userId, from, today).catch(() => []),
  ])

  const logById = new Map(logs.map((l) => [l.id, l]))
  const completed: CompletedRunForStats[] = prescribedRuns
    .filter((r) => r.status === 'completed' && r.activityLogId != null)
    .map((r) => {
      const log = logById.get(r.activityLogId!)
      return {
        runType: r.runType,
        distanceKm: log?.distanceKm ?? null,
        avgPaceSecPerKm: log?.avgPaceSecPerKm ?? null,
        avgHr: log?.avgHr ?? null,
      }
    })

  return NextResponse.json(computeRunTypeStats(completed), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
