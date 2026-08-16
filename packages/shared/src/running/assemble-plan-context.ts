// Shared signal-assembly helpers for the running-plan API routes (GET/POST `/api/running-plan`
// and POST `/api/running-plan/override`) — extracted so the override route can reuse the exact
// same recovery-gate inputs/fitness-snapshot resolution instead of drifting a second copy.
import { getRepository } from '@/lib/data'
import {
  todayInTz, todayMidnightUtc, toAestDay, startOfWeekInTz, shiftDateStr, dateStrMidnightInTz, ageFromDob,
} from '@trainingai/shared/date-utils'
import { computeVolumeAcwr, computeMonotonyStrain } from '@trainingai/shared/ai-periodization/acwr'
import { resolveFitnessSnapshot } from '@trainingai/shared/running/fitness-snapshot'
import { isLowerBodyMuscle } from '@trainingai/shared/running/lower-body'
import { isPushSession, inferEnvironment } from '@trainingai/shared/running/push-sessions'
import { liveReadinessForDay } from '@trainingai/shared/health/live-readiness'
import { prescribeNextRun } from '@trainingai/shared/running/prescription'
import { weekIndexSince } from '@trainingai/shared/running/week-index'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import type { RecoveryGateInputs } from '@trainingai/shared/running/recovery-gate'
import type { FitnessSnapshot, RunType, RunningGoal } from '@trainingai/shared/running/types'
import type { RunningPlan } from '@/lib/data/repository'

// Quality run types — kept in sync with the gate's HARD set; used to find the last completed hard run.
export const HARD_RUN_TYPES = new Set(['interval', 'tempo', 'long'])

// Build the deterministic recovery-gate inputs + framework context from persisted signals.
// Every signal degrades to neutral (null) on absence — the gate never fabricates.
export async function assembleInputs(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string, tz: string, fitness: FitnessSnapshot, plan: RunningPlan,
): Promise<{ ctx: Parameters<typeof prescribeNextRun>[0]; gate: RecoveryGateInputs }> {
  const todayIso = todayInTz(tz)
  const todayMid = todayMidnightUtc(tz)
  const weekStartIso = startOfWeekInTz(tz)
  const from28dDate = new Date(todayMid.getTime() - 28 * 86_400_000)

  const [derivedRows, summaries, sessionLoads, recentSessions, sleepSessions, weekRuns] = await Promise.all([
    repo.getOuraDailyDerived(userId, todayIso, todayIso),
    repo.getOuraDailySummary(userId, todayIso, todayIso),
    repo.getSessionLoadsFrom(userId, from28dDate),
    repo.getWorkoutSessionsFrom(userId, new Date(todayMid.getTime() - 3 * 86_400_000)),
    // Last night only — the gate's short-sleep guard is "last night", not the week's best night (E2-5/J-4).
    repo.listSleepSessions(userId, shiftDateStr(todayIso, -1), todayIso),
    repo.getPrescribedRuns(userId, weekStartIso, todayIso),
  ])

  // Readiness + provisional flag. Readiness is the own BLE-derived composite (source-checked).
  const readiness = liveReadinessForDay(todayIso, derivedRows)
  // "Provisional" means the baseline is genuinely still LEARNING (a summary row exists but n_history
  // is immature) — NOT that today's summary is simply absent (rollup not run yet). Absent data must
  // degrade to neutral, not silently soften the run (E2-8).
  const readinessProvisional = summaries.length > 0 && (summaries[0]?.nHistory ?? 0) < 14

  // Concurrent-training interference: most recent heavy lower-body strength session.
  let hoursSinceLowerBodyStrength: number | null = null
  let lastLowerBodyVolumeKg = 0
  const legSessions = recentSessions
    .filter(ws => ws.exercises.some(e => (e.muscleGroups ?? []).some(isLowerBodyMuscle)))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  const lastLeg = legSessions[0]
  if (lastLeg) {
    // Elapsed hours to NOW (the prescription is being read now) — not to tonight's midnight, which
    // made every pre-today leg session read ≥24h and never trip the interference gate (E2-6/J-3).
    hoursSinceLowerBodyStrength = (Date.now() - lastLeg.startedAt.getTime()) / 3_600_000
    lastLowerBodyVolumeKg = lastLeg.exercises
      .filter(e => (e.muscleGroups ?? []).some(isLowerBodyMuscle))
      .reduce((sum, e) => sum + (e.volume ?? 0), 0)
  }

  // ACWR + Foster monotony over the 28-day / 7-day windows.
  const load = computeVolumeAcwr(sessionLoads.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.volume })), todayMid)
  const last7 = Array.from({ length: 7 }, (_, i) => new Date(todayMid.getTime() - i * 86_400_000))
  const loadByDay = new Map(last7.map(d => [toAestDay(d, tz), 0]))
  for (const ws of sessionLoads) {
    const day = toAestDay(ws.startedAt, tz)
    if (loadByDay.has(day)) loadByDay.set(day, (loadByDay.get(day) ?? 0) + ws.volume)
  }
  const { monotony } = computeMonotonyStrain([...loadByDay.values()])

  // Hours since the most recent COMPLETED hard (quality) run — anchored at the run day's local
  // midnight vs now (day-granular data; the conservative estimate). Gives the gate real
  // no-back-to-back-quality protection.
  const lastHardRun = weekRuns
    .filter(r => r.status === 'completed' && HARD_RUN_TYPES.has(r.runType))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const hoursSinceLastHardRun = lastHardRun
    ? (Date.now() - dateStrMidnightInTz(lastHardRun.date, tz).getTime()) / 3_600_000
    : null

  // Sleep hours last night: the longest session whose wake date is today. The week's best night is
  // the wrong signal for a "last night" guard (E2-5/J-4); absent → neutral (null), never softens.
  // Over nights, not rows (Q-76). `Math.max` already made a nap harmless here, but the reverse case
  // is not: a night split by a wake-up reads as its longer half (4.0 h of a real 6.5 h night on
  // 2026-05-29), which trips the short-sleep guard and softens a run that needed no softening.
  const lastNight = nightSessions(sleepSessions, tz).filter(s => s.date === todayIso).map(s => s.durationHours ?? 0)
  const sleepHoursLastNight = lastNight.length ? Math.max(...lastNight) || null : null

  // Only COMPLETED runs count toward the week's 80/20 sequence — a never-run pending row (created
  // just by opening the tab) must not advance the framework toward an interval day (E2-7).
  const runsThisWeek = weekRuns.filter(r => r.status === 'completed')
  const ctx = {
    fitness,
    weekIndex: weekIndexSince(plan.createdAt, todayMid),
    runsThisWeek: runsThisWeek.map(r => ({ type: r.runType as RunType, durationMin: r.durationMin })),
    goal: {
      kind: plan.goalKind as RunningGoal['kind'],
      targetDistanceKm: plan.targetDistanceKm,
      targetDate: plan.targetDate,
      timePerSessionMinutes: plan.timePerSessionMinutes,
    } as RunningGoal,
  }
  // The gate itself applies the heavy-leg volume threshold — pass the raw computed volume.
  const gate: RecoveryGateInputs = {
    readiness,
    readinessProvisional,
    hoursSinceLowerBodyStrength,
    lastLowerBodyVolumeKg,
    monotony: monotony ?? null,
    acwr: load.acwr,
    hoursSinceLastHardRun,
    sleepHoursLastNight,
  }
  return { ctx, gate }
}

export async function resolveSnapshot(
  repo: Awaited<ReturnType<typeof getRepository>>, userId: string, tz: string,
): Promise<FitnessSnapshot> {
  const todayIso = todayInTz(tz)
  const from90 = toAestDay(new Date(todayMidnightUtc(tz).getTime() - 90 * 86_400_000), tz)
  const [user, metrics] = await Promise.all([
    repo.getUserById(userId),
    repo.listBodyMetrics(userId, from90, todayIso),
  ])
  const restingHr = [...metrics].reverse().find(m => m.restingHeartRate != null)?.restingHeartRate ?? null
  // The cardio-baseline results feed VO₂max / max-HR / threshold-HR when present; guarded
  // so this route works before that sibling ships (falls back to age-based zones).
  let baseline = null
  try {
    const tests = await repo.listFitnessTests(userId, from90, todayIso)
    const best = [...tests].reverse().find(t => t.vo2maxEst != null || t.maxHr != null)
    if (best) baseline = { vo2max: best.vo2maxEst ?? null, maxHr: best.maxHr ?? null, thresholdHr: null, weeklyBaseMinutes: null }
  } catch { baseline = null }
  return resolveFitnessSnapshot({ age: ageFromDob(user?.dateOfBirth, todayMidnightUtc(tz)), restingHr, baseline })
}

export interface PushContext {
  isPush: boolean
  bestDistanceKm: number | null
}

// Push/adherence split (D-3) + environment-aware "beat your best" (D-5) — both derived at read
// time from completed prescribed_runs + their linked activity_logs, never stored (see
// lib/running/push-sessions.ts).
export async function resolvePushContext(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string, plan: RunningPlan, todayIso: string, tz: string,
): Promise<PushContext> {
  const planStartIso = toAestDay(plan.createdAt, tz)
  const completed = (await repo.getPrescribedRuns(userId, planStartIso, todayIso))
    .filter(r => r.status === 'completed' && r.planId === plan.id)
  const isPush = isPushSession(completed.length)
  if (!isPush) return { isPush, bestDistanceKm: null }

  const logIds = completed.map(r => r.activityLogId).filter((id): id is string => id != null)
  if (logIds.length === 0) return { isPush, bestDistanceKm: null }

  const logs = await repo.listActivityLogs(userId, planStartIso, todayIso)
  const matchingLogs = logs.filter(l => logIds.includes(l.id))
  const outdoorLogs = matchingLogs.filter(l => inferEnvironment(l.routePolyline ?? null) === 'outdoor')
  const distances = outdoorLogs.map(l => l.distanceKm).filter((d): d is number => d != null)
  const bestDistanceKm = distances.length > 0 ? Math.max(...distances) : null
  return { isPush, bestDistanceKm }
}
