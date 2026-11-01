import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, toAestDay, secondsSinceLocalMidnight, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { wornHours } from '@trainingai/shared/health/wear-confidence'
import { aggregateWorkoutDay, type DaySession } from '@trainingai/shared/health/workout-density'
import { rollupDailyBestHrr, setHrr60Values } from '@trainingai/shared/workout/hrr-trend'
import { dayStepCountsByDate } from '@trainingai/shared/health/activity-steps'

export interface HealthTrendDay {
  date: string            // YYYY-MM-DD
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  hrvMs: number | null
  rhrBpm: number | null
  hrr1Bpm: number | null  // best-session median HRR60 (bpm/min, dense HR only); derived, not stored; null = not measured
  wornHours: number | null
  sessionDurationMin: number | null
  workoutDensity: number | null  // kg lifted per active minute
  proteinPerKg: number | null    // day's protein_g ÷ the latest known bodyweight in range
  steps: number | null
  waterMl: number | null
  temperatureDeviation: number | null  // °C deviation from personal baseline (Oura daily_readiness)
}

export interface HealthTrendsResponse {
  trends: HealthTrendDay[]  // oldest → newest, up to 14 days
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:health-trends-summary`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  // Step by calendar date, not by 24 h: a DST-change day is 23 or 25 h long.
  const from14dIso = shiftDateStr(todayIso, -14)
  const from14dDate = dateStrMidnightInTz(from14dIso, tz)

  const [ouraRows, derivedRows, bodyRows, workoutSessions, activityLogs] = await Promise.all([
    repo.getOuraDaily(userId, from14dIso, todayIso),
    repo.getOuraDailyDerived(userId, from14dIso, todayIso),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from14dDate),
    // #3095: indoor (treadmill) steps join each day's count, as on the Steps history beside it.
    repo.listActivityLogs(userId, from14dIso, todayIso).catch(() => []),
  ])

  const ouraByDate = new Map(ouraRows.map(r => [r.date, r]))
  // Our own persisted daily scores (oura_daily_derived). The only source for the three score series:
  // Oura's own readiness, sleep and activity scores are never ours (scoring doc rule 5, #3000).
  const derivedByDate = new Map(derivedRows.map(r => [r.day, r]))
  const bodyByDate = new Map(bodyRows.map(r => [r.date, r]))
  const stepsByDate = dayStepCountsByDate(bodyRows, activityLogs)
  const latestWeightKg = bodyRows.find(r => r.weightKg != null)?.weightKg ?? null  // bodyRows is date-descending

  const sessionsByDate = new Map<string, DaySession[]>()
  for (const ws of workoutSessions) {
    const day = toAestDay(ws.startedAt, tz)
    const volumeKg = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    const list = sessionsByDate.get(day) ?? []
    list.push({ startedAt: ws.startedAt, completedAt: ws.completedAt ?? null, volumeKg, pausedSec: ws.pausedSec })
    sessionsByDate.set(day, list)
  }

  // HRR trend — re-derive each completed session's per-set HRR60 from its HR window (server-only
  // aggregate, same posture as weekly-stats). HRR60 (`deriveHrr60`, #2457) is the one measured
  // one-minute recovery: it needs dense HR, so a ring-only set is null and its day a gap. #2234: the
  // nearest-reading `hrr1` from analyseHrRecovery turned two idle ring readings a minute apart into
  // a 0-bpm "recovery", which the sparkline plotted as a point. Bounded: one HR-window read + one
  // set-timestamp read per completed session in range (≤ ~14), parallelised.
  const completedSessions = workoutSessions.filter(ws => ws.completedAt != null)
  const perSessionHrr = await Promise.all(
    completedSessions.map(async ws => {
      const from = new Date(ws.startedAt.getTime() - 10 * 60 * 1000)
      const to   = new Date(ws.completedAt!.getTime() + 10 * 60 * 1000)
      const [readings, sets] = await Promise.all([
        repo.getHrForWindow(userId, from, to),
        repo.getSetTimestampsForSession(userId, ws.id),
      ])
      return { day: toAestDay(ws.startedAt, tz), hrr1Values: setHrr60Values(readings, sets) }
    }),
  )
  const hrrByDay = rollupDailyBestHrr(perSessionHrr)

  const trends: HealthTrendDay[] = []
  for (let i = 13; i >= 0; i--) {
    const d = shiftDateStr(todayIso, -i)
    const oura = ouraByDate.get(d)
    const derived = derivedByDate.get(d)
    const body = bodyByDate.get(d)
    const { sessionDurationMin, workoutDensity } = aggregateWorkoutDay(sessionsByDate.get(d) ?? [])
    trends.push({
      date: d,
      readinessScore: derived?.readinessScore ?? null,
      sleepScore: derived?.sleepScore ?? null,
      activityScore: derived?.activityScore ?? null,
      hrvMs: body?.hrvMs ?? null,
      rhrBpm: body?.restingHeartRate ?? null,
      hrr1Bpm: hrrByDay.get(d) ?? null,
      wornHours: wornHours(oura?.nonWearTimeSec, d === todayIso ? secondsSinceLocalMidnight(tz) : 86400),
      sessionDurationMin,
      workoutDensity,
      proteinPerKg: body?.proteinG != null && latestWeightKg != null
        ? Math.round((body.proteinG / latestWeightKg) * 10) / 10
        : null,
      steps: stepsByDate.get(d) ?? null,
      waterMl: body?.waterMl ?? null,
      temperatureDeviation: oura?.temperatureDeviation ?? null,
    })
  }

  return NextResponse.json({ trends } satisfies HealthTrendsResponse, { headers: { "Cache-Control": "private, no-store" } })
}
