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
  // Q-453: `(raw ? normalize(raw) : null) ?? today` reads a normaliser's `null` as "use the
  // default", but `null` here means two different things — *absent* (default to today, which the
  // caller asked for by omitting it) and *present but malformed* (a caller who asked for a specific
  // day and mistyped it). This route was the only one of eleven that conflated them: nine siblings
  // 400, and the response carries no echo of which date it answered for, so a caller asking for the
  // 10th with a typo got the 17th's numbers with nothing indicating the substitution.
  const date = raw ? normalizeDateParamIso(raw) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

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

  // Q-270. The gate reason is persisted on EVERY evaluation, not only on the success path, and that
  // is the whole point: `training_load_ots` has been NULL on all 104 days and three diagnoses have
  // been wrong because "the route was never called" and "the route ran and refused" are
  // indistinguishable from outside. With this, NULL means the first and a string means the second.
  //
  // 'ok' rather than null on the success path is load-bearing — the upsert COALESCEs, so a null
  // would leave a morning's 'insufficient_met' standing on a day that scored by afternoon.
  try {
    await repo.upsertOuraDailyDerived(userId, date, result.status === 'ok'
      ? { trainingLoadOts: result.ots, trainingLoadHigh: result.high, trainingLoadGate: 'ok' }
      : { trainingLoadGate: result.reason })
  } catch (err) {
    console.error('[training-stress] persist failed (read still served):', err)
  }

  return NextResponse.json(result satisfies TrainingStressResponse, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
