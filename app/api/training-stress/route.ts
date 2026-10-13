import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { WorkoutRepository } from '@/lib/data/repository'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, ageFromDob, dateStrMidnightInTz, shiftDateStr, localClockTimeToDate } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { computeTrainingStress, metGridFromDaytimeSamples, type TrainingStressResult } from '@trainingai/shared/health/training-stress'
import { restingHrForDay, TRAINING_STRESS_RHR_WINDOW_DAYS } from '@trainingai/shared/health/training-stress-rhr'
import { staleTrainingStressDays, TRAINING_STRESS_RECHECK_DAYS } from '@trainingai/shared/health/training-stress-recheck'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import { resolveDayMetPerMinute } from '@trainingai/shared/health/met-input'
import { ouraIdForActivityType } from '@trainingai/shared/health/daily-energy'
import { metForActivity, intensityFromRpe } from '@trainingai/shared/health/workout-energy'
import type { ActivityLog } from '@trainingai/shared/types/body'
import { resolveMinutes } from '@trainingai/shared/inputs/cascade'
import { stepCandidates, MAX_KCAL_RECORD_MIN } from '@trainingai/shared/inputs/adapters'

/** #2115 v4: how far back rung 1b may reach for a weight to convert active calories with. */
const KCAL_MET_WEIGHT_WINDOW_DAYS = 30

/** `rhrFromDay` is set only when the day had no resting heart rate of its own and an earlier one was used (#2401). */
export type TrainingStressResponse = TrainingStressResult & { rhrFromDay?: string }

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
  // floor. Once a day has ended, evaluate it once more over the whole day. The stamp is what
  // makes this finite: a verdict computed after the day's end is final and is never redone.
  // #2400: every finished day in the look-back, not only yesterday — a day the app was not opened
  // after kept its partial-day verdict. One at a time and fire-and-forget, so the read never waits
  // on it and a first visit does not open seven evaluations at once.
  if (!raw) {
    const from = shiftDateStr(date, -TRAINING_STRESS_RECHECK_DAYS)
    const rows = await repo.getOuraDailyDerived(userId, from, shiftDateStr(date, -1)).catch(() => [])
    const stale = staleTrainingStressDays(
      date, tz, new Map(rows.map(r => [r.day, r.trainingLoadEvaluatedAt ?? null])),
    )
    void (async () => {
      for (const day of stale) {
        await evaluateTrainingStressDay(repo, userId, tz, day)
          .catch(err => console.error(`[training-stress] re-evaluating ${day} failed:`, err))
      }
    })()
  }

  return NextResponse.json(result satisfies TrainingStressResponse, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** Computes one day's verdict and persists it, stamped with when it was computed (LA-170). */
async function evaluateTrainingStressDay(
  repo: WorkoutRepository, userId: string, tz: string, date: string,
): Promise<TrainingStressResponse> {
  const dayStart = dateStrMidnightInTz(date, tz)
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)
  const rhrWindowStart = shiftDateStr(date, -TRAINING_STRESS_RHR_WINDOW_DAYS)
  // #2115 v4: rung 1b converts active calories with the latest weight within 30 days.
  const weightWindowStart = shiftDateStr(date, -KCAL_MET_WEIGHT_WINDOW_DAYS)
  // A Health Connect record that starts before midnight can still cover the day's first minutes.
  const intervalsFrom = new Date(dayStart.getTime() - MAX_KCAL_RECORD_MIN * 60_000)

  const [derivedRows, summaryRows, bodyMetrics, user, daytime, sleepRows, activityRows, kcalRows, stepRows] = await Promise.all([
    repo.getOuraDailyDerived(userId, date, date),
    repo.getOuraDailySummary(userId, date, date),
    repo.listBodyMetrics(userId, weightWindowStart < rhrWindowStart ? weightWindowStart : rhrWindowStart, date),
    repo.getUserById(userId),
    repo.getOuraDaytimeSignals(userId, dayStart, dayEnd),
    // The night ending this morning is dated today; the one starting tonight is dated tomorrow.
    repo.listSleepSessions(userId, date, shiftDateStr(date, 1)),
    repo.listActivityLogs(userId, date, date),
    movementIntervals(repo, userId, 'active_kcal', intervalsFrom, dayEnd),
    movementIntervals(repo, userId, 'steps', intervalsFrom, dayEnd),
  ])

  const derived = derivedRows[0] ?? null
  // Readiness must be our own BLE-derived composite, never the frozen Cloud row.
  const readiness = derived?.readinessSource === 'ble-derived' ? derived.readinessScore : null
  const readinessProvisional = (summaryRows[0]?.nHistory ?? 0) < BASELINE_MIN_NIGHTS

  // Weight stays the day's own; only the resting heart rate borrows from earlier days (#2401).
  const latestBm = bodyMetrics.filter(m => m.date === date).at(-1) ?? null
  const rhr = restingHrForDay(bodyMetrics, date, rhrWindowStart)
  const kcalWeightKg = bodyMetrics.filter(m => m.date >= weightWindowStart && m.weightKg != null).at(-1)?.weightKg ?? null
  const age = ageFromDob(user?.dateOfBirth, new Date())

  // #2115 v4: the day's `MET/min`, minute by minute from local midnight to the end of the day (or
  // now, for today), each minute from the best route that has it. The ring's own grid is rung 1 (J-6:
  // keyed on each bin's wall-clock minute, so charger gaps stay gaps); a minute nothing fills stays
  // null, and `computeTrainingStress` caps and renormalises over those.
  const grid = metGridFromDaytimeSamples(daytime.met)
  const met = resolveDayMetPerMinute({
    ringGrid: grid,
    ringMotion: daytime.motion ?? [],
    ringStillFramesMs: daytime.still ?? [],
    sleepSessions: sleepRows.map(r => ({
      startMs: new Date(r.sleepStart).getTime(), endMs: new Date(r.sleepEnd).getTime(),
      source: r.ouraId?.startsWith('ble:') ? 'oura_ble' : 'sleep_record',
    })),
    activities: activityRows.flatMap(a => activityWindow(a, tz)),
    activeKcal: kcalRows.map(r => ({
      startMs: r.startAt.getTime(), endMs: r.endAt.getTime(), kcal: r.value, source: r.dataOrigin ?? 'health_connect',
    })),
    weightKg: kcalWeightKg,
    // Rung 2c reads the named input `steps/min`, so Health Connect's step records are resolved into
    // it first (overlapping apps de-duplicated by `stepCandidates`), then mapped through cadence.
    stepsPerMinute: resolveMinutes('steps/min', stepCandidates(
      stepRows.map(r => ({ startMs: r.startAt.getTime(), endMs: r.endAt.getTime(), steps: r.value })),
      'device_steps', 'health_connect',
    ), dayStart.getTime(), dayEnd.getTime()),
  }, dayStart.getTime(), Math.min(dayEnd.getTime(), Date.now()))

  const result = computeTrainingStress({
    startTimestampMs: met.startTimestampMs,
    metsPerMinute: met.metsPerMinute,
    metMix: met.mix,
    age,
    sex: user?.sex ?? null,
    rhr: rhr?.value ?? null,
    readiness,
    readinessProvisional,
    vo2maxInputs: {
      restingHr: rhr?.value ?? null,
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
  return rhr != null && rhr.day !== date ? { ...result, rhrFromDay: rhr.day } : result
}

/** A logged activity's minutes and Compendium MET (rung 3 of `MET/min`), or nothing when it has no
 *  clock times. The type maps to the energy table's activity id, never by name (identity is the id). */
function activityWindow(a: ActivityLog, tz: string): { startMs: number; endMs: number; met: number | null; source: string }[] {
  const start = localClockTimeToDate(a.date, a.startTime, tz)
  let end = localClockTimeToDate(a.date, a.endTime, tz)
  if (!start) return []
  if (!end && a.durationMin != null && a.durationMin > 0) end = new Date(start.getTime() + a.durationMin * 60_000)
  if (!end) return []
  // An end before the start crossed midnight.
  const endMs = end.getTime() <= start.getTime() ? end.getTime() + 86_400_000 : end.getTime()
  return [{ startMs: start.getTime(), endMs, met: metForActivity(ouraIdForActivityType(a.activityType), intensityFromRpe(null)), source: 'activity_log' }]
}

async function movementIntervals(repo: WorkoutRepository, userId: string, kind: 'steps' | 'active_kcal', from: Date, to: Date) {
  const [legacy, native] = await Promise.all([
    repo.getHealthConnectIntervals(userId, kind, from, to),
    repo.getNativeMovementIntervals?.(userId, kind, from, to) ?? Promise.resolve([]),
  ]);
  return [...legacy, ...native];
}
