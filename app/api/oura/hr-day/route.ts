import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParam, shiftDateStr } from '@trainingai/shared/date-utils'
import { fromZonedTime } from 'date-fns-tz'
import { gradedNightForDate } from '@trainingai/shared/health/sleep-night'
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
    // sleep_sessions.date is the wake-up date. The day before is read too: the night is grouped by
    // its windows, and a fragment that ended before midnight carries the earlier date.
    repo.listSleepSessions(session.user.id, shiftDateStr(dateParam, -1), dateParam),
  ])

  // The night the Sleep score and the sleep card describe, never a daytime rest that happened to be
  // listed first (#3662).
  const primary = gradedNightForDate(sleepRows, dateParam, tz)
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
