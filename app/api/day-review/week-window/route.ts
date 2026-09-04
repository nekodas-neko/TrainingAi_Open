import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import {
  DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, dateStrMidnightInTz, toAestDay,
} from '@trainingai/shared/date-utils'

/** One day of the comparison window. A stat is null when nothing was recorded for it that day —
 *  never 0, which would read as "you did nothing" rather than "nothing was measured". */
export interface WeekWindowDay {
  date: string
  restingHeartRate: number | null
  steps: number | null
  sessionVolumeKg: number | null
  weightKg: number | null
}

export interface WeekWindowResponse {
  /** Echoed so a caller can tell which day it got — the Q-453 lesson from the sibling route. */
  date: string
  /** Ascending, `date - 7` … `date` inclusive: eight points, the last one being `date` itself. */
  days: WeekWindowDay[]
  /** Mean over the seven days BEFORE `date`, nulls excluded. Null when that week recorded nothing. */
  sevenDayAverages: Omit<WeekWindowDay, 'date'>
}

// GET /api/day-review/week-window?date=YYYY-MM-DD — the prior-7-day series for the four stats the
// day review draws a trend on (Q-112c). Serves both readings the render needs from one payload: the
// eight-point series for a sparkline, and the seven-day mean for a "vs. last week" delta.
//
// Deliberately only these four. The plan's own next phase says body composition moves too slowly to
// read as anything but noise over seven days, and scores already carry `scoreBand()`'s word — so a
// series for either would be surface nothing is allowed to draw.
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = new URL(req.url).searchParams.get('date')
  // Absent means "today", which is what omitting it asks for. Present-but-malformed is a caller who
  // asked for a specific day and mistyped it, and answering with today's numbers under their date
  // is the silent substitution Q-453 found in the sibling route.
  const date = raw ? normalizeDateParamIso(raw) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  if (!rateLimit(`${userId}:day-review-week-window`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const from = shiftDateStr(date, -7)
  const repo = await getRepository()

  const [metrics, sessions] = await Promise.all([
    repo.listBodyMetrics(userId, from, date),
    // Anchored at the window's own local midnight, never `Date.now() - N × 86_400_000` — an
    // ms-offset window straddles two local days and merges them (CLAUDE.md, six prior copies).
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(from, tz)),
  ])

  const byDate = new Map(metrics.map(m => [m.date, m]))

  // Several sessions can share a day, so volume is summed per day rather than last-write-wins.
  const volumeByDate = new Map<string, number>()
  for (const ws of sessions) {
    if (ws.exercises.length === 0) continue
    const day = toAestDay(ws.startedAt, tz)
    if (day < from || day > date) continue
    const volume = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    volumeByDate.set(day, (volumeByDate.get(day) ?? 0) + volume)
  }

  const days: WeekWindowDay[] = Array.from({ length: 8 }, (_, i) => {
    const d = shiftDateStr(from, i)
    const m = byDate.get(d)
    const volume = volumeByDate.get(d)
    return {
      date: d,
      restingHeartRate: m?.restingHeartRate ?? null,
      steps: m?.steps ?? null,
      sessionVolumeKg: volume == null ? null : Math.round(volume),
      weightKg: m?.weightKg ?? null,
    }
  })

  // The mean excludes `date` itself — comparing a day against a window it is inside pulls the
  // baseline toward the value being judged, which is what makes a delta read smaller than it is.
  const prior = days.slice(0, 7)
  const mean = (pick: (d: WeekWindowDay) => number | null): number | null => {
    const values = prior.map(pick).filter((v): v is number => v != null)
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  const body: WeekWindowResponse = {
    date,
    days,
    sevenDayAverages: {
      restingHeartRate: mean(d => d.restingHeartRate),
      steps: mean(d => d.steps),
      sessionVolumeKg: mean(d => d.sessionVolumeKg),
      weightKg: mean(d => d.weightKg),
    },
  }

  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}
