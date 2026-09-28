import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { WorkoutRepository } from '@/lib/data/repository'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, ageFromDob, dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
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
  const result = await evaluateTrainingStressDay(repo, userId, tz, date)

  // LA-170. The route is only ever asked about TODAY, so a day's stored verdict used to be whichever
  // evaluation ran last WHILE it was happening — and a morning one cannot clear the 720-minute MET
  // floor. Once yesterday has ended, evaluate it once more over the whole day. The stamp is what
  // makes this finite: a verdict computed after the day's end is final and is never redone.
  // Fire-and-forget, so the read never waits on it.
  if (!raw) {
    const yesterday = shiftDateStr(date, -1)
    const [row] = await repo.getOuraDailyDerived(userId, yesterday, yesterday).catch(() => [])
    const evaluatedAt = row?.trainingLoadEvaluatedAt ?? null
    if (evaluatedAt == null || evaluatedAt < dateStrMidnightInTz(date, tz)) {
      evaluateTrainingStressDay(repo, userId, tz, yesterday)
        .catch(err => console.error('[training-stress] re-evaluating yesterday failed:', err))
    }
  }

  return NextResponse.json(result satisfies TrainingStressResponse, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** Computes one day's verdict and persists it, stamped with when it was computed (LA-170). */
async function evaluateTrainingStressDay(
  repo: WorkoutRepository, userId: string, tz: string, date: string,
): Promise<TrainingStressResult> {
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
      // LA-161: the grid dimensions go on every path, gated or not — a gate reason without the
      // numbers it was decided from is what made TN-79 an inference exercise.
      ? { trainingLoadOts: result.ots, trainingLoadHigh: result.high, trainingLoadGate: 'ok',
          trainingLoadGridLen: result.metGridLen, trainingLoadValidMin: result.metValidMin,
          trainingLoadEvaluatedAt: new Date() }
      : { trainingLoadGate: result.reason,
          trainingLoadGridLen: result.metGridLen, trainingLoadValidMin: result.metValidMin,
          trainingLoadEvaluatedAt: new Date() })
  } catch (err) {
    console.error('[training-stress] persist failed (read still served):', err)
  }
  return result
}
