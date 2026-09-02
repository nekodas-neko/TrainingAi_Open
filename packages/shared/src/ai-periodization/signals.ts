import type { WorkoutRepository } from '@/lib/data/repository'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import { todayInTz, todayMidnightUtc, toAestDay, startOfWeekInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { confidenceFactors, computeConfidence } from '@trainingai/shared/ai-periodization/confidence'
import { perExerciseRpeDelta, rpeTrendFromSets } from '@trainingai/shared/ai-periodization/expected-rpe'
import { computeVolumeAcwr } from '@trainingai/shared/ai-periodization/acwr'
import { latestIllnessFromDerived, illnessZScores, type IllnessFlag } from '@trainingai/shared/health/illness-radar'
import { liveReadinessForDay } from '@trainingai/shared/health/live-readiness'
import { sleepDurationTrend, sleepScoreTrend } from '@trainingai/shared/health/sleep-trend'
import { moodMuscleMatches, normalizeMuscle } from '@trainingai/shared/muscles'
import { sessionsRemainingThisWeek } from '@trainingai/shared/schedule-utils'
import { volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'
import { projectRm } from '@trainingai/shared/health/strength-projection'
import { oneRmTrendStatus } from '@trainingai/shared/1rm'
import { workingBudgetMin } from '@trainingai/shared/workout/duration-model'
import { buildTimeProfiles, type ExerciseTimeProfile } from '@trainingai/shared/workout/time-profile'
import { robustAvgSetDurationsByExercise, buildMeasuredTimeBudget, resolveTransitionSec } from '@trainingai/shared/workout/time-audit'
import { excludeLowWearDays, toOuraByDate } from '@trainingai/shared/health/wear-confidence'

export interface PrescriptionSignals {
  trainingGoal: string
  autoApplyPrescriptions: boolean
  effectiveTimeBudgetMin: number
  exercises: Array<{
    sessionExerciseId: string
    name: string
    role: string
    muscleGroups: string[]
    muscleAssignments: Array<{ muscle: string; role: 'main' | 'secondary' }>
    baseline1rm: number | null
    current1rm: number | null
    /** So the prompt renders a bodyweight 1RM as a rep max, not kilograms (Q-19b). */
    exerciseType: string | null
    rm1Trend: 'up' | 'flat' | 'down'
    rm1ChangeKg: number
    avgSetDurationSec: number
    // Measured work/rest profile (null until history accrues) — see lib/workout/time-profile.ts.
    timeProfile: ExerciseTimeProfile | null
    equipment: string[]
    transitionSec: number
    // True when the 90-day estimated-1RM trend is flat (see lib/health/strength-projection).
    plateau: boolean
    // RPE autoregulation inputs (null when insufficient recent data):
    // rpeDelta = avg (actual RPE − expected RPE) over this exercise's recent sets;
    // repCompletionRate = actual ÷ prescribed reps last session.
    rpeDelta: number | null
    repCompletionRate: number | null
  }>
  phase: string
  sessionsInPhase: number
  hoursSinceLastSession: number | null
  consecutiveSessionDaysOfThisType: number
  // Muscle-specific soreness cross-referenced against today's session exercises.
  // soreMusclesInSession: sore muscles that appear in this session (relevant).
  // soreMusclesOutOfSession: sore but in muscles not trained today (irrelevant).
  // sorenessLogDate: which day's mood log was used ('today', 'yesterday', or 'none').
  soreMusclesInSession: string[]
  // Lifter said "Sick / Unwell" in TODAY's readiness check-in. Drives a rest-day
  // recommendation, and deloads the session if they train anyway.
  selfReportedSick: boolean
  soreMusclesOutOfSession: string[]
  sorenessLogDate: 'today' | 'yesterday' | 'none'
  // Active (unresolved) injuries whose muscle matches something trained in today's
  // session — a stronger, more reliable signal than subjective soreness above.
  activeInjuredMusclesInSession: string[]
  // This morning's subjective check-in (phase='morning' day_checkin), null if none.
  morningCheckin: {
    wakeMood: number | null
    perceivedRecovery: number | null
    sleepQualityFeel: number | null
    restingSoreness: number | null
    illnessContext: import('@trainingai/shared/types/day-checkin').IllnessContext | null
  } | null
  rpeTrend: { avgActual: number; avgExpected: number; delta: number } | null
  repCompletionRate: number | null
  weeklyTargets: Record<string, number>
  weeklyLogged: Record<string, number>
  volumeBudgetPerMuscleGroup: Record<string, number>
  acwr: number | null
  sleepTrend: number | null
  // Quality trend over the same recent-3-vs-baseline windows, from our own
  // computeSleepScore (efficiency/stages/latency/restfulness) — null until ≥4 scored nights.
  // The rest-day rule prefers this over the duration-only sleepTrend when available.
  sleepScoreTrend: number | null
  hrvTrend: number | null
  spo2Trend: number | null
  // Last night's skin-temperature baseline z-score (oura_daily_summary via the shared
  // illnessZScores — the live BLE source; oura_daily.temperature_deviation is frozen
  // Cloud data and must never feed this). Positive = fever-consistent. null until a
  // temperature baseline exists.
  tempZ: number | null
  // Latest persisted illness-radar reading (oura_daily_derived — last night, or the night
  // before when last night hasn't rolled up yet). null = no data or baseline still learning.
  illness: { flag: IllnessFlag; score: number } | null
  // Hook for external readiness data (e.g. Oura). Treated as one signal among
  // many — not a source of truth. null when no integration is active.
  externalReadiness: number | null
  // Own whole-day training-stress (OTS) state for today — the purpose-built overtraining
  // signal (F9). null when the model gated (insufficient MET / learning).
  trainingLoadOts: number | null
  trainingLoadHigh: boolean | null
  // Own stress-resilience level (1–5) for the latest night with a reading (F9). null = no data.
  resilienceLevel: number | null
  confidenceTier: 1 | 2 | 3
  confidence: number
  // Plain-English factors limiting confidence (empty when the engine has full data).
  confidenceReasons: string[]
}

// The subset of per-exercise signal the AI-prescription CARD renders — identity, role, and the
// PR-derived strength trend. Extracted so the light read path
// (GET /api/ai-periodization/session/[id]) and the full aggregation below derive it from exactly
// the same inputs and rules; the card must never be able to disagree with the engine about whether
// a lift is trending up. Everything else aggregateSignals computes (timing profiles, ACWR, sleep,
// HRV, SpO2, illness, plateau projection...) exists for the LLM prompt, not the card.
export interface CardExerciseSignal {
  sessionExerciseId: string
  name: string
  role: string
  current1rm: number | null
  rm1Trend: 'up' | 'flat' | 'down'
  rm1ChangeKg: number
}

export function buildCardExerciseSignals(
  exercises: Array<{ id: string; exerciseName: string; exerciseRole: string }>,
  allPrs: Map<string, number>,
  prevPrs: Map<string, number>,
): CardExerciseSignal[] {
  return exercises.map(ex => {
    const current1rm = allPrs.get(ex.exerciseName) ?? null
    const prev1rm = prevPrs.get(ex.exerciseName) ?? null
    const status = current1rm != null ? oneRmTrendStatus(current1rm, prev1rm) : 'none'
    return {
      sessionExerciseId: ex.id,
      name: ex.exerciseName,
      role: ex.exerciseRole,
      current1rm,
      rm1Trend: status === 'up' ? 'up' : status === 'down' ? 'down' : 'flat',
      rm1ChangeKg: current1rm != null && prev1rm != null ? current1rm - prev1rm : 0,
    }
  })
}

// One deterministic self-reported-illness signal, fed by either of two independent check-ins
// (Q-113): the mood check-in's bodyState, and the Morning Check-in's illness/context flag (which
// replaced the old "Motivation" scale specifically so it feeds this signal rather than a new,
// parallel one). Shared by every site that resolves this — signals.ts, the ai_dynamic
// recommendation path (adapter.ts), and the same-day reevaluate path (workout-data route) — so
// the three don't drift the way this exact bug class has before ("One Formula, One Place").
export function resolveSelfReportedSick(
  bodyState: string[] | undefined,
  illnessContext: import('@trainingai/shared/types/day-checkin').IllnessContext | null | undefined,
): boolean {
  return (bodyState?.includes('sick') ?? false) || illnessContext === 'sick'
}

export async function aggregateSignals(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  // The session whose completion triggered this call (from complete-workout's post-completion hook).
  // Excluded from the hoursSinceLastSession gap only — it has completedAt ≈ now by construction, which
  // would otherwise spuriously satisfy the emergency-deload <36h condition (W5 §4.2). Left in last5
  // for RPE / prescription-guard logic, which legitimately want the just-completed session.
  excludeSessionId?: string,
  // Today-only override of the session's configured time budget (the short/long presets).
  // Undefined = use the program's own timeBudgetMinutes.
  budgetOverrideMin?: number,
): Promise<PrescriptionSignals | null> {
  const today = todayInTz(tz)
  const todayMid = todayMidnightUtc(tz)

  const [rawState, program, allPrs, prevPrs, injuries] = await Promise.all([
    repo.getSessionPeriodization(userId, programSessionId),
    repo.getActiveProgram(userId),
    repo.listPersonalRecords(userId),
    repo.listPrevious1rm(userId),
    repo.listInjuries(userId),
  ])

  if (!rawState || !program) return null

  // sessionsInPhase reaches the prescription prompt from here, so heal it before reading it
  // (SYNC-T2). The prescribe path reconciles upstream in generate-prescription, but the
  // workout-review caller does not, and a drifted count changes what the AI is told.
  const state = await repo.reconcileSessionsInPhase(userId, program.id)
    .then(() => repo.getSessionPeriodization(userId, programSessionId))
    .catch(() => rawState) ?? rawState

  const programSession = program.sessions.find(s => s.id === programSessionId)
  if (!programSession) return null

  const volumeTargets = await repo.listVolumeTargets(userId, program.id)
  const exerciseNames = programSession.exercises.map(e => e.exerciseName)
  // Q-489: shifted on the date string. The `from7d` line below was already correct — it anchors on
  // `todayMid`, the user's local midnight — and this one was the outlier.
  const yesterday = shiftDateStr(toAestDay(todayMid, tz), -1)
  const from7d = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)

  const [recentSessions, timingRows, muscleAssignmentsMap, equipmentMap, exerciseTypeMap, todayMoodLog, yesterdayMoodLog, allRecentSessions, morningCheckinRow, rm1Histories, timingAudit, derivedRows, dailySummaries] = await Promise.all([
    repo.getRecentSessionsOfType(userId, programSessionId, 60),
    repo.getSetTimingRows(userId, exerciseNames),
    repo.getExerciseMuscleAssignments(exerciseNames),
    repo.getExerciseEquipment(exerciseNames),
    repo.getExerciseTypes(exerciseNames),
    repo.getMoodLog(userId, today),
    repo.getMoodLog(userId, yesterday),
    // ACWR needs volume-load across ALL session types, not just this one — a lifter who
    // trains Push/Pull/Legs has their real acute:chronic load spread across all three.
    repo.getWorkoutSessionsFrom(userId, new Date(todayMid.getTime() - 28 * 86_400_000)),
    repo.getDayCheckin(userId, today, 'morning'),
    repo.getExercise1rmHistory(userId, exerciseNames, tz),
    // Learned transition (bar-load) + warmup medians across all session types — the
    // planner substitutes these for the duration-model constants once enough history
    // exists (per-exercise/class transition ≥5 samples, warmup ≥8 sessions), so faster
    // warmups/transitions free budget for more working sets.
    repo.getTimingAuditData(userId, 90),
    // Latest persisted illness-radar reading — a decision-layer read of oura_daily_derived (S3).
    repo.getOuraDailyDerived(userId, yesterday, today),
    // Skin-temp baseline z (live BLE) — same source the readiness/illness surfaces use.
    repo.getOuraDailySummary(userId, from7d, today),
  ])

  const timeProfiles = buildTimeProfiles(timingRows)
  const avgSetDurations = robustAvgSetDurationsByExercise(
    timingRows.filter((r): r is typeof r & { setTimeSec: number } => r.setTimeSec != null),
  )
  const measuredTimeBudget = buildMeasuredTimeBudget(timingAudit.sessions, timingAudit.sets, timingAudit.exercises)

  const morningCheckin = morningCheckinRow ? {
    wakeMood: morningCheckinRow.wakeMood,
    perceivedRecovery: morningCheckinRow.perceivedRecovery,
    sleepQualityFeel: morningCheckinRow.sleepQualityFeel,
    restingSoreness: morningCheckinRow.restingSoreness,
    illnessContext: morningCheckinRow.illnessContext,
  } : null

  // Scope to sessions from this program's start so prior programs don't skew signals
  const programStart = program.createdAt
  const programSessions = recentSessions.filter(s => s.startedAt >= programStart)
  const last5 = programSessions.slice(0, 5)

  // Build exercise signal array.
  // baseline1rm is retained as the starting weight anchor only — do NOT use
  // it for strength trend comparison; use rm1Trend (current vs previous PR) instead.
  const cardSignalsById = new Map(
    buildCardExerciseSignals(programSession.exercises, allPrs, prevPrs).map(c => [c.sessionExerciseId, c]),
  )
  const exercises = programSession.exercises.map(ex => {
    // Identity/role/trend come from the shared derivation the card also uses — one rule, so the
    // card and the engine can never disagree about a lift's strength trend.
    const card = cardSignalsById.get(ex.id)!
    const baseline = state.baseline1rm[ex.id]?.kg ?? null

    const libraryAssignments = muscleAssignmentsMap[ex.exerciseName]
    const muscleAssignments = libraryAssignments && libraryAssignments.length > 0
      ? libraryAssignments
      : ex.muscleGroups.map(mg => ({ muscle: mg, role: 'main' as const }))

    const rm1History = rm1Histories[ex.exerciseName] ?? []
    const plateau = rm1History.length >= 4 ? (projectRm(rm1History)?.plateau ?? false) : false

    return {
      sessionExerciseId: card.sessionExerciseId,
      name: card.name,
      role: card.role,
      muscleGroups: ex.muscleGroups,
      muscleAssignments,
      baseline1rm: baseline,
      current1rm: card.current1rm,
      rm1Trend: card.rm1Trend,
      rm1ChangeKg: card.rm1ChangeKg,
      avgSetDurationSec: avgSetDurations[ex.exerciseName] ?? 45,
      timeProfile: timeProfiles[ex.exerciseName] ?? null,
      exerciseType: exerciseTypeMap[ex.exerciseName] ?? null,
      equipment: equipmentMap[ex.exerciseName] ?? [],
      transitionSec: resolveTransitionSec(ex.exerciseName, equipmentMap[ex.exerciseName], measuredTimeBudget),
      plateau,
    }
  })

  // RPE trend from last 3 program-scoped sessions — both a program-wide aggregate (for the
  // emergency-deload safety net) and a per-exercise delta (for RPE autoregulation).
  let rpeTrend: PrescriptionSignals['rpeTrend'] = null
  let perExRpeDelta = new Map<string, number>()
  if (last5.length >= 1) {
    const last3Ids = last5.slice(0, 3).map(s => s.id)
    const setLogs = await repo.getSetLogsForSessions(last3Ids)
    rpeTrend = rpeTrendFromSets(setLogs)
    // Per-exercise: reps-aware expected RPE so a hard AMRAP set (reps ≈ max) reads as ~on-target,
    // and (Q-514) floor-clamped sets dropped rather than neutralised — `expectedRpe` answers 5 for
    // a set the model actually expects at ~0.6, so their delta measures the clamp, not the athlete.
    // `rpeTrendFromSets` above deliberately keeps every set: it is the emergency-deload safety net,
    // and the same bias makes it fire slightly EARLY, which is the safe direction.
    perExRpeDelta = perExerciseRpeDelta(setLogs)
  }

  // Hours since last session
  let hoursSinceLastSession: number | null = null
  const lastCompleted = last5.find(s => s.completedAt != null && s.id !== excludeSessionId)
  if (lastCompleted?.completedAt) {
    hoursSinceLastSession = (Date.now() - lastCompleted.completedAt.getTime()) / 3_600_000
  }

  // Consecutive days of this session type ending today
  let consecutiveSessionDaysOfThisType = 0
  if (last5.length > 0) {
    const trainedDays = new Set(last5.map(s => toAestDay(s.startedAt, tz)))
    let cursor = today
    while (trainedDays.has(cursor)) {
      consecutiveSessionDaysOfThisType++
      cursor = shiftDateStr(cursor, -1)
    }
  }

  const sessionMuscleGroups = programSession.exercises.flatMap(e => e.muscleGroups)

  // Active (unresolved) injuries relevant to today's session — a more reliable signal
  // than subjective soreness, so it's surfaced separately and also gates emergency deload.
  const activeInjuredMusclesInSession = [...new Set(
    injuries
      .filter(i => !i.resolvedDate)
      .map(i => i.muscleName)
      .filter(muscle => sessionMuscleGroups.some(mg => moodMuscleMatches(mg, muscle)))
  )]

  // Muscle-specific soreness from mood logs.
  // Today's log takes precedence; only fall back to yesterday's if no check-in today.
  // This ensures a clean check-in today clears yesterday's soreness flag.
  let sorenessLogDate: 'today' | 'yesterday' | 'none' = 'none'
  const soreMusclesInSession: string[] = []
  const soreMusclesOutOfSession: string[] = []

  // Self-reported illness from the readiness check-in. Distinct from `illness` below, which is
  // the biometric radar (skin temp / HRV): the lifter saying "I'm unwell" is a first-class
  // signal and was stored but never read by the engine until 2026-07-29. Only TODAY's check-in
  // counts — unlike soreness, yesterday's illness must not silently deload today's session.
  const selfReportedSick = resolveSelfReportedSick(todayMoodLog?.bodyState, morningCheckinRow?.illnessContext)

  const moodLogToUse = todayMoodLog ?? yesterdayMoodLog
  if (moodLogToUse) {
    sorenessLogDate = todayMoodLog ? 'today' : 'yesterday'
    if (moodLogToUse.bodyState.includes('sore_muscles') && moodLogToUse.soreMuscles.length > 0) {
      for (const soreMuscle of moodLogToUse.soreMuscles) {
        const relevant = sessionMuscleGroups.some(mg => moodMuscleMatches(mg, soreMuscle))
        if (relevant) {
          soreMusclesInSession.push(soreMuscle)
        } else {
          soreMusclesOutOfSession.push(soreMuscle)
        }
      }
    }
  }

  // Rep completion rate from last session vs prescription — program-wide (emergency-deload
  // trigger) and per-exercise (sizes the RPE-autoregulation back-off cut).
  let repCompletionRate: number | null = null
  const perExCompletion = new Map<string, number>()
  if (state.lastSessionRanPrescription && state.sessionsInPhase > 0 && state.prescription && last5.length > 0) {
    const lastSessionId = last5[0].id
    const lastSetLogs = await repo.getSetLogsForSessions([lastSessionId])
    const prescribedRepsMap: Record<string, number> = {}
    for (const ex of state.prescription.exercises) {
      prescribedRepsMap[ex.sessionExerciseId] = ex.sets * ex.reps
    }
    let totalPrescribed = 0
    let totalActual = 0
    for (const ex of programSession.exercises) {
      const prescribed = prescribedRepsMap[ex.id]
      if (!prescribed) continue
      const actual = lastSetLogs
        .filter(sl => sl.exerciseName === ex.exerciseName)
        .reduce((sum, sl) => sum + sl.reps, 0)
      totalPrescribed += prescribed
      totalActual += actual
      perExCompletion.set(ex.exerciseName, actual / prescribed)
    }
    if (totalPrescribed > 0) {
      repCompletionRate = totalActual / totalPrescribed
    }
  }

  // Weekly volume
  const weekStart = startOfWeekInTz(tz)
  const weekEnd = shiftDateStr(weekStart, 6)

  // getWeeklySetsByMuscleGroup returns canonical names; programSession.exercises still returns raw
  // exercise-library labels, so those are normalized where they are read below.
  const weeklyLogged = await repo.getWeeklySetsByMuscleGroup(userId, program.id, weekStart, weekEnd, tz)

  const weeklyTargets: Record<string, number> = {}
  for (const vt of volumeTargets) {
    weeklyTargets[normalizeMuscle(vt.muscleGroup)] = vt.targetSetsPerWeek
  }

  const volumeBudgetPerMuscleGroup: Record<string, number> = {}
  const hasAnyTarget = Object.keys(weeklyTargets).length > 0
  if (hasAnyTarget) {
    const daysIntoWeek = Math.round((Date.parse(today) - Date.parse(weekStart)) / 86_400_000) // 0..6
    const sessionsRemaining = sessionsRemainingThisWeek(program, 7 - daysIntoWeek)
    const allMuscles = new Set<string>()
    for (const ex of programSession.exercises) {
      for (const mg of ex.muscleGroups) allMuscles.add(normalizeMuscle(mg))
    }
    for (const mg of allMuscles) {
      const target = weeklyTargets[mg] ?? 0
      const logged = weeklyLogged[mg] ?? 0
      // Cap at MRV headroom so a target-chasing budget never pushes a muscle past its
      // maximum recoverable volume for the week, even if the per-session share would.
      volumeBudgetPerMuscleGroup[mg] = Math.min(
        Math.ceil(Math.max(0, target - logged) / sessionsRemaining),
        Math.max(0, volumeLandmarks(program.trainingGoal, mg).mrv - logged),
      )
    }
  }

  // Volume-load ACWR across ALL session types (matches readiness-score) — a lifter's
  // real acute:chronic load is spread across every session type they train, not just
  // this one, and the shared helper's own gates (≥21d span, ≥6 sessions) replace the
  // old flat-÷4 chronic divisor that inflated ACWR ~2x on young programs.
  const acwr = computeVolumeAcwr(
    allRecentSessions.map(ws => ({
      startedAt: ws.startedAt,
      volumeKg: ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0),
    })),
    todayMid,
  ).acwr

  // Sleep trends — duration ratio + our-own-sleep-score quality ratio over the same
  // recent-3-vs-baseline windows (lib/health/sleep-trend.ts — One Formula, One Place).
  const from14d = toAestDay(new Date(todayMid.getTime() - 14 * 86_400_000), tz)
  const sleepSessions = await repo.listSleepSessions(userId, from14d, today)
  const sleepTrend = sleepDurationTrend(sleepSessions, tz)
  const sleepScoreTrendVal = sleepScoreTrend(sleepSessions, tz)

  // HRV trend — same pattern: recent 3 days vs older baseline.
  // null when insufficient data. The older baseline excludes low-wear-time days
  // (one shared filter with readiness-score's HRV/RHR baselines) — an unworn
  // ring's HRV reading is unreliable and shouldn't anchor what "normal" looks
  // like. The recent-3 window is left unfiltered — it reflects current status.
  let hrvTrend: number | null = null
  const bodyMetrics = await repo.listBodyMetrics(userId, from14d, today)
  const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)
  if (hrvRows.length >= 4) {
    const sorted = [...hrvRows].sort((a, b) => b.date.localeCompare(a.date))
    const recent3 = sorted.slice(0, 3)
    const ouraForHrvWindow = toOuraByDate(await repo.getOuraDaily(userId, from14d, today))
    const older = excludeLowWearDays(sorted.slice(3), ouraForHrvWindow).slice(0, 7)
    if (older.length > 0) {
      const recentAvg = recent3.reduce((s, m) => s + m.hrvMs!, 0) / recent3.length
      const olderAvg = older.reduce((s, m) => s + m.hrvMs!, 0) / older.length
      hrvTrend = olderAvg > 0 ? recentAvg / olderAvg : null
    }
  }

  // SpO2 trend — same recent-3-vs-older-baseline pattern, reusing the bodyMetrics
  // already fetched for HRV above. A drop can flag illness/altitude/poor recovery.
  let spo2Trend: number | null = null
  const spo2Rows = bodyMetrics.filter(m => m.spo2Pct != null && m.spo2Pct > 0)
  if (spo2Rows.length >= 4) {
    const sorted = [...spo2Rows].sort((a, b) => b.date.localeCompare(a.date))
    const recent3 = sorted.slice(0, 3)
    const older = sorted.slice(3, 10)
    if (older.length > 0) {
      const recentAvg = recent3.reduce((s, m) => s + m.spo2Pct!, 0) / recent3.length
      const olderAvg = older.reduce((s, m) => s + m.spo2Pct!, 0) / older.length
      spo2Trend = olderAvg > 0 ? recentAvg / olderAvg : null
    }
  }

  const latestIllness = latestIllnessFromDerived(derivedRows)
  const illness = latestIllness ? { flag: latestIllness.flag, score: latestIllness.score } : null
  // Today's derived row (OTS is a whole-day signal keyed to today, unlike illness's latest-available).
  const todayDerived = derivedRows.find(r => r.day === today) ?? null

  // Skin-temp z vs the PRIOR night's baseline — the identical pre-update relationship
  // the readiness route and nightly rollup use, so prescription/readiness/illness can
  // never disagree about last night's temperature.
  const latestSummary = dailySummaries.length > 0 ? dailySummaries[dailySummaries.length - 1] : null
  const priorSummary = dailySummaries.length > 1 ? dailySummaries[dailySummaries.length - 2] : null
  const tempZ = latestSummary ? illnessZScores(priorSummary, latestSummary).tempZ : null

  // Confidence scoring — one deterministic input set shared by the score and the
  // plain-English reasons list, so they can never disagree about what's missing.
  const has1rmHistory = exercises.some(e => e.current1rm != null && e.baseline1rm != null)
  const hasMoodData = sorenessLogDate !== 'none'
  const confidenceInputs = {
    recentSessionCount: last5.length,
    has1rmHistory,
    hasMoodOrSoreness: soreMusclesInSession.length > 0 || soreMusclesOutOfSession.length > 0 || hasMoodData,
    hasAcwr: acwr != null,
    hasSleepOrHrvTrend: sleepTrend != null || hrvTrend != null,
  }
  const { confidence, tier: confidenceTier } = computeConfidence(confidenceInputs)
  const confidenceReasons = confidenceFactors(confidenceInputs)

  const exercisesWithAutoreg = exercises.map(ex => ({
    ...ex,
    rpeDelta: perExRpeDelta.get(ex.name) ?? null,
    repCompletionRate: perExCompletion.get(ex.name) ?? null,
  }))

  return {
    trainingGoal: program.trainingGoal,
    autoApplyPrescriptions: program.autoApplyPrescriptions,
    effectiveTimeBudgetMin: workingBudgetMin(
      budgetOverrideMin ?? programSession.timeBudgetMinutes,
      measuredTimeBudget.warmupSec != null ? measuredTimeBudget.warmupSec / 60 : null,
      programSession.timeBudgetMinutes,
    ),
    exercises: exercisesWithAutoreg,
    phase: state.phase,
    sessionsInPhase: state.sessionsInPhase,
    hoursSinceLastSession,
    consecutiveSessionDaysOfThisType,
    soreMusclesInSession,
    soreMusclesOutOfSession,
    sorenessLogDate,
    selfReportedSick,
    activeInjuredMusclesInSession,
    morningCheckin,
    rpeTrend,
    repCompletionRate,
    weeklyTargets,
    weeklyLogged,
    volumeBudgetPerMuscleGroup,
    acwr,
    sleepTrend,
    sleepScoreTrend: sleepScoreTrendVal,
    hrvTrend,
    spo2Trend,
    tempZ,
    illness,
    // Live composite (our BLE-derived readiness), never the frozen Cloud column. `today` is
    // always post-re-key, so no Cloud fallback is needed — derivedRows is already in scope.
    externalReadiness: liveReadinessForDay(today, derivedRows),
    trainingLoadOts: todayDerived?.trainingLoadOts ?? null,
    trainingLoadHigh: todayDerived?.trainingLoadHigh ?? null,
    resilienceLevel: [...derivedRows].reverse().find(r => r.resilienceLevel != null)?.resilienceLevel ?? null,
    confidenceTier,
    confidence,
    confidenceReasons,
  }
}
