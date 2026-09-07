import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { bucketize, correlationInsight, buildExercise1rmBaseline, sessionMean1RmPct, type BucketDef, type CorrelationStats, type WithheldReason } from '@trainingai/shared/health/correlation'
import { nightSessions } from '@trainingai/shared/health/sleep-night'

export interface SleepCorrelationResponse {
  insight: string
  buckets: { label: string; avgPctChange: number; count: number }[]
  hasSufficientData: boolean
  /** n / r / p behind the claim (Q-75). */
  stats?: CorrelationStats
  /** Set when a sentence was deliberately withheld, and why. */
  withheld?: WithheldReason
}

const BUCKETS: BucketDef[] = [
  { label: '<6h',  min: 0, max: 6  },
  { label: '6–7h', min: 6, max: 7  },
  { label: '7–8h', min: 7, max: 8  },
  { label: '8h+',  min: 8, max: 99 },
]

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const from90dDate = new Date(todayMid.getTime() - 90 * 86_400_000)
  const from90dIso  = formatInTimeZone(from90dDate, tz, 'yyyy-MM-dd')

  const [workoutSessions, sleepSessions] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, from90dDate),
    repo.listSleepSessions(userId, from90dIso, todayIso),
  ])

  // Map: wake-up date string → sleep duration hours.
  //
  // Nights, not rows (Q-76). A raw `listSleepSessions` pass puts a 0.1 h evening bout and the 7.6 h
  // night that followed it on the same date, and last-write-wins picked whichever came back last —
  // 21 % of this correlation's x-values were not nights. `nightSessions` classifies by circadian
  // position, so naps drop out and a night split by a wake-up (2026-05-29: 2.5 h + 4.0 h) comes back
  // as the one ~6.5 h night it was.
  const sleepByDate = new Map<string, number>()
  for (const s of nightSessions(sleepSessions, tz)) {
    if (s.durationHours != null) {
      sleepByDate.set(s.date, s.durationHours)
    }
  }

  // Step 1+2: per-exercise baseline mean — only exercises with ≥3 sessions.
  const baseline = buildExercise1rmBaseline(workoutSessions)

  // Step 3: ONE point per DAY, keyed by the sleep before it (PS-29).
  //
  // This pushed one point per EXERCISE, all carrying the same `x`. Four days of five lifts read as
  // n = 20: it cleared `DEFAULT_MIN_N`, the p-value was computed at 20, and `correlationInsight`
  // rendered "20 paired days" for four. Points from one day are not independent observations of
  // anything — they share their x exactly — so the inflation is in the direction that manufactures
  // significance.
  //
  // Aggregated by DAY rather than by session, which is where this differs from the bucketed views
  // in /api/health-trends. Theirs key on a per-SESSION x (rest adherence, session RPE), so two
  // sessions really are two observations; here x is one night's sleep, identical for every session
  // that follows it, so a day is the unit. `sessionMean1RmPct` is the same aggregate either way.
  const byDay = new Map<string, { sleepHours: number; pcts: number[]; dayIndex: number }>()
  // Day index for the calendar-confounder control (Q-75) — relative to the first workout in range,
  // so the origin is arbitrary but the spacing is real, which is all a partial correlation needs.
  const firstDayMs = workoutSessions.length ? workoutSessions[0].startedAt.getTime() : 0
  for (const ws of workoutSessions) {
    const workoutDate = toAestDay(ws.startedAt, tz)
    const prevDate    = toAestDay(new Date(ws.startedAt.getTime() - 86_400_000), tz)
    const sleepHours  = sleepByDate.get(workoutDate) ?? sleepByDate.get(prevDate)
    if (sleepHours == null) continue

    const meanPct = sessionMean1RmPct(ws, baseline)
    if (meanPct == null) continue

    const day = byDay.get(workoutDate)
    if (day) day.pcts.push(meanPct)
    else byDay.set(workoutDate, {
      sleepHours,
      pcts: [meanPct],
      dayIndex: Math.round((ws.startedAt.getTime() - firstDayMs) / 86_400_000),
    })
  }

  const points: { x: number; y: number }[] = []
  const control: number[] = []
  // Sorted so `control` is monotonic in real time; Map iteration is insertion order, and the
  // sessions arrive ordered, but the partial correlation should not depend on that holding.
  for (const [, day] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    points.push({ x: day.sleepHours, y: day.pcts.reduce((a, v) => a + v, 0) / day.pcts.length })
    control.push(day.dayIndex)
  }

  const rawBuckets = bucketize(points, BUCKETS)
  const buckets = rawBuckets.map(b => ({ label: b.label, avgPctChange: b.avg, count: b.count }))

  const fmt = (v: number) => v >= 0 ? `${v.toFixed(1)}% above` : `${Math.abs(v).toFixed(1)}% below`
  const { insight, hasSufficientData, stats, withheld } = correlationInsight(
    rawBuckets,
    (best, worst) => `After ${best.label} sleep your lifts average ${fmt(best.avg)} baseline — vs ${fmt(worst.avg)} after ${worst.label}.`,
    undefined,
    {
      insufficient: 'Not enough paired sleep + workout data yet.',
      noDifference: 'Sleep duration shows minimal effect on your performance so far.',
    },
    { points, control },
  )

  return NextResponse.json({ insight, buckets, hasSufficientData, stats, withheld } satisfies SleepCorrelationResponse, { headers: { "Cache-Control": "private, no-store" } })
}
