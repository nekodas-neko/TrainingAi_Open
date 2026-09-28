import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { computeBodyBatteryDay } from '@/lib/health/body-battery-day'

export type { BodyBatteryPoint, BodyBatteryResponse } from '@/lib/health/body-battery-day'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:body-battery`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const tz = session.user?.timezone ?? DEFAULT_TZ
    const repo = await getRepository()
    const { response, snapshot } = await computeBodyBatteryDay({
      repo, userId, tz, date: todayInTz(tz), until: new Date(), computeReadinessIfMissing: true,
    })
    // Write-through: every read updates today's row, so the last read of the day captures the
    // end-of-day value. Fire-and-forget so the read never waits on it (the 499 path under the
    // home/health burst), with a catch so a rejection cannot surface as an unhandledRejection.
    repo.upsertBodyBatteryDaily(userId, snapshot).catch(() => { /* snapshot is best-effort — never fail the read */ })
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } })
  } catch (err) {
    // This route 500'd in production on 2026-08-03 and left no trace: it had no catch, so nothing
    // reached error_events and there was no stack to work from. It reproduces on neither the seeded
    // local DB nor any test. Reporting is the only way the next occurrence is diagnosable.
    reportServerError(err, { userId, url: '/api/body-battery' })
    return NextResponse.json({ error: 'Body battery unavailable' }, { status: 500 })
  }
}
