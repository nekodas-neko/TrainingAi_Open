import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { errorLog } from '@trainingai/shared/logger'
import {
  DEFAULT_TZ, dateStrMidnightInTz, localClockTimeToDate, normalizeDateParamIso, shiftDateStr, todayInTz,
} from '@trainingai/shared/date-utils'
import { metGridFromDaytimeSamples } from '@trainingai/shared/health/training-stress'
import { detectWalksFromMet } from '@trainingai/shared/health/walk-detection'
import { deviceMetGrid } from '@trainingai/shared/health/met-input'
import { ouraCloudMetGrid } from '@trainingai/shared/health/oura-cloud-met'

// #2471 (owner direction 2026-10-06): the walks in one day's MET (the ring's, then Oura's, #2985) that the user has not logged,
// for the phone to offer as "Looks like you walked 9:10–9:32. Save it?". Called after every ring
// sync the app sees settle (`ta:oura-ble-synced`, which the app-open drain also fires).
//
// Computed on read, never stored: the MET is already on the server, so a candidate is a
// function of it and of what the user has logged, and a saved walk drops out by being logged. The
// phone remembers what it dismissed (`auto-detection-store`). The rule is `detectWalksFromMet`.
const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
}).strict()

export interface WalkCandidatesResponse {
  date: string
  walks: { startMs: number; endMs: number; durationMin: number; meanMet: number }[]
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`walk-candidates:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const parsed = QuerySchema.safeParse({ date: req.nextUrl.searchParams.get('date') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const date = parsed.data.date != null ? normalizeDateParamIso(parsed.data.date) : todayInTz(tz)
  if (date == null) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  try {
    const repo = await getRepositoryAsync()
    const dayStart = dateStrMidnightInTz(date, tz)
    const dayEnd = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
    const [daytime, cloudActivity, sleepRows, lifting, activities] = await Promise.all([
      repo.getOuraDaytimeSignals(userId, dayStart, dayEnd),
      // #2985: Oura's MET series where the ring has none. Its day starts at 4 a.m., hence the day before.
      repo.getOuraCloudActivitySeries(userId, shiftDateStr(date, -1), date),
      // The night ending this morning is dated today; the one starting tonight, tomorrow.
      repo.listSleepSessions(userId, date, shiftDateStr(date, 1)),
      // This one takes the date slash-separated.
      repo.getDaySessionSummaries(userId, date.replace(/-/g, '/'), tz),
      repo.listActivityLogs(userId, date, date),
    ])

    const exclusions = [
      ...sleepRows.map(r => ({ startMs: new Date(r.sleepStart).getTime(), endMs: new Date(r.sleepEnd).getTime() })),
      // A session still open is excluded to now: the user is lifting, not walking.
      ...lifting.map(s => ({ startMs: s.startedAt.getTime(), endMs: (s.completedAt ?? new Date()).getTime() })),
      // Stored as HH:MM:SS (Postgres time); the parser takes HH:MM.
      ...activities.flatMap(a => {
        const start = localClockTimeToDate(a.date, a.startTime?.slice(0, 5), tz)
        if (!start) return []
        const end = localClockTimeToDate(a.date, a.endTime?.slice(0, 5), tz)
          ?? (a.durationMin != null ? new Date(start.getTime() + a.durationMin * 60_000) : null)
        return end && end > start ? [{ startMs: start.getTime(), endMs: end.getTime() }] : []
      }),
    ]

    const grid = deviceMetGrid(
      metGridFromDaytimeSamples(daytime.met),
      ouraCloudMetGrid(cloudActivity, dayStart.getTime(), dayEnd.getTime()),
      dayStart.getTime(), dayEnd.getTime(),
    )
    const walks = detectWalksFromMet(grid, exclusions)
      .filter(w => w.startMs >= dayStart.getTime() && w.startMs < dayEnd.getTime())

    return NextResponse.json({ date, walks } satisfies WalkCandidatesResponse, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    errorLog(error, 'API /activity-detection/walks')
    return NextResponse.json({ error: 'Could not read walks' }, { status: 500 })
  }
}
