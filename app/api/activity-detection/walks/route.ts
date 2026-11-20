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
import { perMinuteMovementGrid } from '@trainingai/shared/health/per-minute-movement'

// #2471 (owner direction 2026-10-06): the walks in one day's MET (the ring's, then Oura's, #2985) that the user has not logged,
// for the phone to offer as "Looks like you walked 9:10–9:32. Save it?". Called after every ring
// sync the app sees settle (`ta:oura-ble-synced`, which the app-open drain also fires).
//
// Computed on read, never stored: the MET is already on the server, so a candidate is a
// function of it and of what the user has logged, and a saved walk drops out by being logged. The
// phone remembers what it dismissed (`auto-detection-store`). The rule is `detectWalksFromMet`.
//
// #3844: since the phone's live GPS detector was removed, this offer and the source's own recorded
// workouts are where walks come from. A walk that overlaps one of those workouts is left out: the
// workout already counts it (`lib/health/oura-budget-activities.ts`, the day timeline).
const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
}).strict()

export interface WalkCandidatesResponse {
  date: string
  walks: { startMs: number; endMs: number; durationMin: number; meanMet: number }[]
  /** #3625: the day's logged activities and source-recorded workouts, as plain spans. A phone that
   *  keeps an earlier offer until it is answered (as the current app's store does) drops one that a
   *  span here now covers, so a walk logged elsewhere since is not offered twice. */
  covered: { startMs: number; endMs: number }[]
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
    const [daytime, movementSeries, sleepRows, lifting, activities, sourceWorkouts] = await Promise.all([
      repo.getOuraDaytimeSignals(userId, dayStart, dayEnd),
      // #2985: a connector's movement series where the ring has none. A source's day may start before
      // local midnight (Oura's at 4 a.m.), hence the day before.
      repo.getPerMinuteMovementSeries(userId, shiftDateStr(date, -1), date),
      // The night ending this morning is dated today; the one starting tonight, tomorrow.
      repo.listSleepSessions(userId, date, shiftDateStr(date, 1)),
      // This one takes the date slash-separated.
      repo.getDaySessionSummaries(userId, date.replace(/-/g, '/'), tz),
      repo.listActivityLogs(userId, date, date),
      // #3844: the workouts a connected source recorded itself (Oura's, today). A source files a
      // workout under its own day, so the read is widened a day each side. Best-effort: a failed read
      // offers what the MET alone finds, as before.
      repo.getOuraWorkouts(userId, { from: shiftDateStr(date, -1), to: shiftDateStr(date, 1) }).catch(() => []),
    ])

    // Stored as HH:MM:SS (Postgres time); the parser takes HH:MM.
    const loggedSpans = activities.flatMap(a => {
      const start = localClockTimeToDate(a.date, a.startTime?.slice(0, 5), tz)
      if (!start) return []
      const end = localClockTimeToDate(a.date, a.endTime?.slice(0, 5), tz)
        ?? (a.durationMin != null ? new Date(start.getTime() + a.durationMin * 60_000) : null)
      return end && end > start ? [{ startMs: start.getTime(), endMs: end.getTime() }] : []
    })
    const exclusions = [
      ...sleepRows.map(r => ({ startMs: new Date(r.sleepStart).getTime(), endMs: new Date(r.sleepEnd).getTime() })),
      // A session still open is excluded to now: the user is lifting, not walking.
      ...lifting.map(s => ({ startMs: s.startedAt.getTime(), endMs: (s.completedAt ?? new Date()).getTime() })),
      ...loggedSpans,
    ]
    // #3844: a walk the source already recorded as a workout is not offered again. Read as a plain
    // interval, whatever the source labelled it. A source's workout often starts after the walk does
    // and ends before it, so these are not exclusions (which would offer the walk's two ends as two
    // short walks): any detected walk that overlaps one is dropped whole.
    const sourceSpans = sourceWorkouts.flatMap(w => {
      const startMs = w.startDatetime.getTime()
      const endMs = w.endDatetime.getTime()
      return endMs > startMs ? [{ startMs, endMs }] : []
    })

    const grid = deviceMetGrid(
      metGridFromDaytimeSamples(daytime.met),
      perMinuteMovementGrid(movementSeries, dayStart.getTime(), dayEnd.getTime()),
      dayStart.getTime(), dayEnd.getTime(),
    )
    const walks = detectWalksFromMet(grid, exclusions)
      .filter(w => w.startMs >= dayStart.getTime() && w.startMs < dayEnd.getTime())
      .filter(w => !sourceSpans.some(x => w.startMs < x.endMs && w.endMs > x.startMs))

    const covered = [...loggedSpans, ...sourceSpans]
      .filter(x => x.startMs < dayEnd.getTime() && x.endMs > dayStart.getTime())

    return NextResponse.json({ date, walks, covered } satisfies WalkCandidatesResponse, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    errorLog(error, 'API /activity-detection/walks')
    return NextResponse.json({ error: 'Could not read walks' }, { status: 500 })
  }
}
