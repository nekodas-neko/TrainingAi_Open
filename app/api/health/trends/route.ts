import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay, secondsSinceLocalMidnight } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { wornHours } from '@trainingai/shared/health/wear-confidence'
import { aggregateWorkoutDay, type DaySession } from '@trainingai/shared/health/workout-density'
import { analyseHrRecovery } from '@trainingai/shared/workout/hr-analysis'
import { rollupDailyBestHrr } from '@trainingai/shared/workout/hrr-trend'

export interface HealthTrendDay {
  date: string            // YYYY-MM-DD
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  hrvMs: number | null
  rhrBpm: number | null
  hrr1Bpm: number | null  // best-session 60s HR-recovery drop (bpm/min); derived, not stored
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
  const todayMid = todayMidnightUtc(tz)
  const from14dDate = new Date(todayMid.getTime() - 14 * 86_400_000)
  const from14dIso = toAestDay(from14dDate, tz)

  const [ouraRows, derivedRows, bodyRows, workoutSessions] = await Promise.all([
    repo.getOuraDaily(userId, from14dIso, todayIso),
    repo.getOuraDailyDerived(userId, from14dIso, todayIso),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from14dDate),
  ])

  const ouraByDate = new Map(ouraRows.map(r => [r.date, r]))
  // Our own persisted daily scores (oura_daily_derived) — the live writer post-re-key.
  // Coalesced over the frozen Cloud columns per day/per score below (S1).
  const derivedByDate = new Map(derivedRows.map(r => [r.day, r]))
  const bodyByDate = new Map(bodyRows.map(r => [r.date, r]))
  const latestWeightKg = bodyRows.find(r => r.weightKg != null)?.weightKg ?? null  // bodyRows is date-descending

  const sessionsByDate = new Map<string, DaySession[]>()
  for (const ws of workoutSessions) {
    const day = toAestDay(ws.startedAt, tz)
    const volumeKg = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    const list = sessionsByDate.get(day) ?? []
    list.push({ startedAt: ws.startedAt, completedAt: ws.completedAt ?? null, volumeKg })
    sessionsByDate.set(day, list)
  }

  // HRR trend — re-derive each completed session's HRR1 from its stored HR window (no persisted
  // column; server-only aggregate, same posture as weekly-stats). Reuses analyseHrRecovery — the
  // single HRR formula. Bounded: one HR-window read + one set-timestamp read per completed session
  // in range (≤ ~14), parallelised.
  const completedSessions = workoutSessions.filter(ws => ws.completedAt != null)
  const perSessionHrr = await Promise.all(
    completedSessions.map(async ws => {
      const from = new Date(ws.startedAt.getTime() - 10 * 60 * 1000)
      const to   = new Date(ws.completedAt!.getTime() + 10 * 60 * 1000)
      const [readings, sets] = await Promise.all([
        repo.getHrForWindow(userId, from, to),
        repo.getSetTimestampsForSession(userId, ws.id),
      ])
      const stats = analyseHrRecovery(readings, sets)
      return { day: toAestDay(ws.startedAt, tz), hrr1Values: stats.map(s => s.hrr1) }
    }),
  )
  const hrrByDay = rollupDailyBestHrr(perSessionHrr)

  const trends: HealthTrendDay[] = []
  for (let i = 13; i >= 0; i--) {
    const d = toAestDay(new Date(todayMid.getTime() - i * 86_400_000), tz)
    const oura = ouraByDate.get(d)
    const derived = derivedByDate.get(d)
    const body = bodyByDate.get(d)
    const { sessionDurationMin, workoutDensity } = aggregateWorkoutDay(sessionsByDate.get(d) ?? [])
    trends.push({
      date: d,
      readinessScore: derived?.readinessScore ?? oura?.readinessScore ?? null,
      sleepScore: derived?.sleepScore ?? oura?.sleepScore ?? null,
      activityScore: derived?.activityScore ?? oura?.activityScore ?? null,
      hrvMs: body?.hrvMs ?? null,
      rhrBpm: body?.restingHeartRate ?? null,
      hrr1Bpm: hrrByDay.get(d) ?? null,
      wornHours: wornHours(oura?.nonWearTimeSec, d === todayIso ? secondsSinceLocalMidnight(tz) : 86400),
      sessionDurationMin,
      workoutDensity,
      proteinPerKg: body?.proteinG != null && latestWeightKg != null
        ? Math.round((body.proteinG / latestWeightKg) * 10) / 10
        : null,
      steps: body?.steps ?? null,
      waterMl: body?.waterMl ?? null,
      temperatureDeviation: oura?.temperatureDeviation ?? null,
    })
  }

  return NextResponse.json({ trends } satisfies HealthTrendsResponse, { headers: { "Cache-Control": "private, no-store" } })
}
