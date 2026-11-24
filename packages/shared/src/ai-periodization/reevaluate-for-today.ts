import { startOfWeekInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { reevaluatePrescriptionForToday, reevaluationKey, type ReevaluationSignals } from '@trainingai/shared/ai-periodization/reevaluate'
import { rowNumbersMoved } from '@trainingai/shared/ai-periodization/prescription-figures'
import { resolveSelfReportedSick, loadFigureSignals } from '@trainingai/shared/ai-periodization/signals'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { sessionSoreness } from '@trainingai/shared/ai-periodization/session-soreness'
import { moodMuscleMatches } from '@trainingai/shared/muscles'
import { rehold } from '@trainingai/shared/ai-periodization/checkin-plan-hold'
import { resolveWorkingBasis } from '@trainingai/shared/1rm'
import type { ProgramDeloadCheck } from '@trainingai/shared/ai-periodization/phase-guards'
import type { LiftPreference } from '@trainingai/shared/ai-periodization/lift-preference'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { ExerciseLibraryEntry, Program, ProgramSession } from '@trainingai/shared/types/program'
import type { LastRealOneRm, WorkoutRepository } from '@/lib/data/repository'

/** What re-evaluating a stored plan against today's signals is told. */
export interface ReevaluateForTodayInputs {
  repo: WorkoutRepository
  userId: string
  tz: string
  /** The user's local date. */
  todayStr: string
  program: Program
  programSession: ProgramSession
  /** The session's stored periodization, and its plan as the reader normalised it (a plan that drives the load). */
  state: SessionPeriodization
  prescription: AiPrescription
  programDeload: ProgramDeloadCheck | null
  underWay: boolean
  liftPreferences: Map<string, LiftPreference>
  libByName: Map<string, ExerciseLibraryEntry>
  lastRealOneRm: Map<string, LastRealOneRm>
  estimateMap: Map<string, number>
  prMap: Map<string, number>
  /** A failed figure re-cost keeps the stored figures; the caller decides where the error goes. */
  onError?: (err: unknown) => void
}

export type ReevaluateForTodayOutcome =
  /** The inputs are the ones this plan was already re-evaluated against: it stands as stored. */
  | { kind: 'current' }
  /** Too old, or a whole-session deload is needed: the caller regenerates (the screen does; a preview does not). */
  | { kind: 'regenerate' }
  /** Re-derived against today's soreness, injuries and illness, held again, and stamped with its inputs. Nothing is stored here. */
  | { kind: 'reevaluated'; prescription: AiPrescription }

/**
 * The ONE consumption-day re-evaluation of a stored AI plan: today's soreness, injuries, illness and
 * the time since the last session move a row's deload, with no model call. A READ: it stores nothing
 * and starts nothing. The session screen's single-session read calls it and then stores the result
 * and fires a regeneration; the Next workout card calls it and does neither (#4019).
 */
export async function reevaluateStoredPlanForToday(i: ReevaluateForTodayInputs): Promise<ReevaluateForTodayOutcome> {
  const { repo, userId, tz, todayStr, program, programSession, state, prescription, programDeload, underWay,
    liftPreferences, libByName, lastRealOneRm, estimateMap, prMap, onError } = i
  const exerciseNames = programSession.exercises.map(ex => ex.exerciseName)
  // Consumption-day re-evaluation (AI-2/AI-3) — re-derive per-exercise soreness/injury
  // deloads against TODAY's signals without re-running the LLM.
  //
  // Two guards were removed here and replaced by one input fingerprint:
  //  - "only if generated on an earlier day" made a prescription generated TODAY (what
  //    the completion-time regeneration produces) never see soreness logged later the
  //    same day — the case where a same-day check-in matters most;
  //  - "only once per calendar date" was stamped by the FIRST read of the day, so a
  //    check-in logged after that (the normal order: open the app, then log how you feel)
  //    could never take effect either.
  // The fingerprint below keeps the cheap skip on repeat fetches while re-running the
  // moment the inputs actually change. All three reads here are cheap, indexed
  // single-user lookups (injuries is a handful of rows at most); they buy skipping the
  // three heavier queries below.
  const [todayMoodLog, yesterdayMoodLog, todayMorningCheckin, injuries] = await Promise.all([
    repo.getMoodLog(userId, todayStr),
    repo.getMoodLog(userId, shiftDateStr(todayStr, -1)),
    repo.getDayCheckin(userId, todayStr, 'morning'),
    repo.listInjuries(userId),
  ])
  const inputsKey = reevaluationKey(todayStr, todayMoodLog ?? yesterdayMoodLog, todayMorningCheckin, injuries)
  if (prescription.reevaluatedInputsKey === inputsKey) return { kind: 'current' }
  const [recentSessions, muscleAssignmentsMap, derivedRows] = await Promise.all([
    repo.getRecentSessionsOfType(userId, programSession.id, 5),
    repo.getExerciseMuscleAssignments(exerciseNames),
    repo.getOuraDailyDerived(userId, shiftDateStr(todayStr, -1), todayStr),
  ])

  // Ignore a session that completed AFTER this prescription was generated — the same
  // rule the generation path applies via excludeSessionId (W5 §4.2). Such a session is
  // already baked into the prescription, and its ~0h gap would otherwise satisfy the
  // emergency-deload "<36h and 3+ sore muscles" condition on the very next open. This
  // matters now that same-day prescriptions re-evaluate at all (previously the
  // generated-day guard made the case unreachable).
  const generatedAt = state.prescriptionGeneratedAt
  const lastCompleted = recentSessions.find(s =>
    s.completedAt != null && (generatedAt == null || s.completedAt <= generatedAt))
  const hoursSinceLastSession = lastCompleted?.completedAt
    ? (Date.now() - lastCompleted.completedAt.getTime()) / 3_600_000
    : null

  const sessionMuscleGroups = programSession.exercises.flatMap(ex => ex.muscleGroups)
  const activeInjuredMusclesInSession = [...new Set(
    injuries
      .filter(i => !i.resolvedDate)
      .map(i => i.muscleName)
      .filter(muscle => sessionMuscleGroups.some(mg => moodMuscleMatches(mg, muscle)))
  )]
  const moodLogToUse = todayMoodLog ?? yesterdayMoodLog
  // #3764: the same split the full aggregation uses — an untouched suggestion changes no load.
  const { soreMusclesInSession, recentlyTrainedMusclesInSession } = sessionSoreness(moodLogToUse, sessionMuscleGroups)

  const reevalSignals: ReevaluationSignals = {
      soreMusclesInSession,
      recentlyTrainedMusclesInSession,
      hoursSinceLastSession,
      activeInjuredMusclesInSession,
      trainingGoal: program.trainingGoal,
      illnessFlag: latestIllnessFromDerived(derivedRows)?.flag ?? null,
      selfReportedSick: resolveSelfReportedSick(todayMoodLog?.bodyState, todayMorningCheckin?.illnessContext),
      exercises: programSession.exercises.map(ex => ({
        sessionExerciseId: ex.id,
        name: ex.exerciseName,
        // Same library→muscleGroups fallback as generation time (signals.ts): without it a
        // custom/non-library exercise re-evaluates with zero assignments, so its per-exercise
        // deload silently reverts to full load while the muscle is still sore (E2-2).
        muscleAssignments: muscleAssignmentsMap[ex.exerciseName]?.length
          ? muscleAssignmentsMap[ex.exerciseName]
          : ex.muscleGroups.map(mg => ({ muscle: mg, role: 'main' as const })),
      })),
  }
  const reevalState = {
    phase: state.phase,
    prescription: state.prescription,
    prescriptionStatus: state.prescriptionStatus,
    prescriptionExpiresAt: state.prescriptionExpiresAt,
    sessionsInPhase: state.sessionsInPhase,
    programDeload,
    underWay,
  }
  let reevalResult = reevaluatePrescriptionForToday(prescription, reevalSignals, reevalState)

  // Issue 2592: a deload or revert moved rows, so the stored minutes and volume pills describe
  // the old rows. Re-cost them through `prescriptionFigures` — the inputs it needs are loaded
  // only now, when a row actually moved, and a failed load keeps the stored figures (the rows
  // are still right; only the header would lag).
  if (!reevalResult.needsRegenerate && reevalResult.changed
    && rowNumbersMoved(prescription.exercises, reevalResult.prescription.exercises)) {
    try {
      const figureSignals = await loadFigureSignals(repo, userId, programSession)
      reevalResult = reevaluatePrescriptionForToday(prescription, reevalSignals, reevalState, new Date(), figureSignals)
    } catch (err) {
      onError?.(err)
    }
  }

  if (reevalResult.needsRegenerate) return { kind: 'regenerate' }

  // #3890: the re-evaluation runs after the serve step held the plan, and its revert puts a
  // deloaded row's pre-deload (unheld) load back. Hold the result again, from the preferences
  // already read, so neither this response nor the cached plan carries a held lift above its bar.
  const reheld = rehold(reevalResult.prescription, state.phase, startOfWeekInTz(tz), liftPreferences, name => {
    const lib = libByName.get(name.toLowerCase())
    return {
      basisKg: resolveWorkingBasis({
        lastNonDeload1rm: lastRealOneRm.get(name)?.estimated1rm,
        seedEstimate: estimateMap.get(name),
        allTimePr1rm: prMap.get(name),
      }),
      equipment: lib?.equipment ?? [],
      bodyweight: lib?.exerciseType === 'bodyweight',
    }
  })
  return { kind: 'reevaluated', prescription: { ...reheld, reevaluatedInputsKey: inputsKey } }
}
