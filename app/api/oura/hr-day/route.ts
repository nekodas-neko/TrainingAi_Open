import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParam } from '@trainingai/shared/date-utils'
import { fromZonedTime } from 'date-fns-tz'
import { pickPrimarySleep } from '@/lib/sleep/primary-sleep'
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = req.nextUrl.searchParams.get('date')
  const norm = raw ? normalizeDateParam(raw) : todayInTz(tz).replace(/-/g, '/')
  if (!norm) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const dateParam = norm.replace(/\//g, '-')       // downstream expects 'YYYY-MM-DD'

  // Convert local date midnight → UTC timestamps for the DB query
  const [y, m, d] = dateParam.split('-').map(Number)
  const from = fromZonedTime(new Date(y, m - 1, d, 0, 0, 0), tz)
  const to   = fromZonedTime(new Date(y, m - 1, d, 23, 59, 59), tz)

  const repo = await getRepositoryAsync()
  const [rows, sleepRows] = await Promise.all([
    repo.getHrForWindow(session.user.id, from, to),
    // sleep_sessions.date is the wake-up date, so the overnight sleep for this
    // chart is the row dated `dateParam` — no prior-day query needed.
    repo.listSleepSessions(session.user.id, dateParam, dateParam),
  ])

  const primary = pickPrimarySleep(sleepRows)
  const sleep = primary
    ? bedtimeToMinuteWindow(primary.sleepStart, primary.sleepEnd, dateParam, tz)
    : null

  return NextResponse.json({
    date: dateParam,
    readings: rows.map(r => ({
      timestamp: r.timestamp.toISOString(),
      bpm:       r.bpm,
      source:    r.source,
    })),
    sleep,
  }, { headers: { "Cache-Control": "private, no-store" } })
}
