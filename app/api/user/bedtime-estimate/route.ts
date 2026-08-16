import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { computeSleepStartConsistency } from '@trainingai/shared/health/sleep-consistency'
import { nightSessions } from '@trainingai/shared/health/sleep-night'

const FALLBACK_HOUR = 22
const FALLBACK_MINUTE = 0

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const since = formatInTimeZone(subDays(new Date(), 14), tz, 'yyyy-MM-dd')

  const sleepSessions = await repo.listSleepSessions(userId, since, today)
  // The estimate is "when does this person go to bed", so it must average the start of NIGHTS
  // (Q-76). A 19:14 evening bout is a `sleepStart` like any other to the raw list, and it drags the
  // mean an hour earlier — the one thing this route exists to get right. `nightSessions` also
  // reassembles a night split by a wake-up, so its start is the real bedtime rather than the
  // 02:23 restart.
  const { meanMinutesFromNoon } = computeSleepStartConsistency(
    nightSessions(sleepSessions, tz).map(s => s.sleepStart.toISOString()),
    tz,
  )

  let bedtimeHour = FALLBACK_HOUR
  let bedtimeMinute = FALLBACK_MINUTE
  if (meanMinutesFromNoon != null) {
    const minutesSinceMidnight = (Math.round(meanMinutesFromNoon) + 720 + 1440) % 1440
    bedtimeHour = Math.floor(minutesSinceMidnight / 60)
    bedtimeMinute = minutesSinceMidnight % 60
  }

  return NextResponse.json({ bedtimeHour, bedtimeMinute }, { headers: { 'Cache-Control': 'private, no-store' } })
}
