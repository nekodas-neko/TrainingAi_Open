import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, ageFromDob, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { computeTrainingStress, metGridFromDaytimeSamples, type TrainingStressResult } from '@trainingai/shared/health/training-stress'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

export type TrainingStressResponse = TrainingStressResult

// GET /api/training-stress?date=YYYY-MM-DD — assembles the day's OTS from our own derived
// readiness + derived VO₂max + the ring's MET stream, persists it (best-effort) to
// oura_daily_derived, and returns it. Gated (200 with status:'gated') when readiness is still
// learning / absent, the profile is incomplete, or there isn't enough MET signal.
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = new URL(req.url).searchParams.get('date')
  const date = (raw ? normalizeDateParamIso(raw) : null) ?? todayInTz(tz)

  if (!rateLimit(`${userId}:training-stress`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const dayStart = dateStrMidnightInTz(date, tz)
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)

  const [derivedRows, summaryRows, bodyMetrics, user, daytime] = await Promise.all([
    repo.getOuraDailyDerived(userId, date, date),
    repo.getOuraDailySummary(userId, date, date),
    repo.listBodyMetrics(userId, date, date),
    repo.getUserById(userId),
    repo.getOuraDaytimeSignals(userId, dayStart, dayEnd),
  ])

  const derived = derivedRows[0] ?? null
  // Readiness must be our own BLE-derived composite, never the frozen Cloud row.
  const readiness = derived?.readinessSource === 'ble-derived' ? derived.readinessScore : null
  const readinessProvisional = (summaryRows[0]?.nHistory ?? 0) < BASELINE_MIN_NIGHTS

  const latestBm = bodyMetrics[bodyMetrics.length - 1] ?? null
  const age = ageFromDob(user?.dateOfBirth, new Date())

  // Build a true 1-min MET grid keyed on each bin's wall-clock minute (J-6): non-wear/charger
  // gaps become nulls the OTS core cleans, instead of compressing the day by array index.
  const grid = metGridFromDaytimeSamples(daytime.met)
  const startTimestampMs = grid.metsPerMinute.length > 0 ? grid.startTimestampMs : dayStart.getTime()

  const result = computeTrainingStress({
    startTimestampMs,
    metsPerMinute: grid.metsPerMinute,
    age,
    sex: user?.sex ?? null,
    rhr: latestBm?.restingHeartRate ?? null,
    readiness,
    readinessProvisional,
    vo2maxInputs: {
      restingHr: latestBm?.restingHeartRate ?? null,
      measuredMaxHr: null,
      age,
      sex: user?.sex ?? null,
      weightKg: latestBm?.weightKg ?? null,
      heightCm: user?.heightCm ?? null,
      activityLevel: user?.activityLevel ?? null,
    },
    tzChange: 0,
  })

  if (result.status === 'ok') {
    try {
      await repo.upsertOuraDailyDerived(userId, date, {
        trainingLoadOts: result.ots,
        trainingLoadHigh: result.high,
      })
    } catch (err) {
      console.error('[training-stress] persist failed (read still served):', err)
    }
  }

  return NextResponse.json(result satisfies TrainingStressResponse, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
