import { capitalize } from '@trainingai/shared/format/capitalize'
import { buildAutomaticPhaseStatus, isEarlyDeloadWeek } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'
import { prescriptionDrivesLoad } from '@trainingai/shared/ai-periodization/apply-prescription'
import { normalizeStoredPrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'
import type { ProgramDeloadCheck } from '@trainingai/shared/ai-periodization/phase-guards'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { Program, ProgramPhase, ProgramSession } from '@trainingai/shared/types/program'
import {
  aiDynamicFallbackPhaseStatus,
  buildWorkoutExercises,
  type BuildWorkoutExercisesCtx,
  type PhaseStatus,
  type WorkoutExercise,
} from './session-data'

/** Everything `buildWorkoutExercises` takes that does not depend on which session is read. */
export type SharedSessionBuildCtx = Pick<
  BuildWorkoutExercisesCtx,
  'lastLogs' | 'lastRealOneRm' | 'prMap' | 'estimateMap' | 'styleById' | 'styleByName' | 'styles' | 'libByName' | 'liftPreferences'
>

/** What one read of a session, from stored state alone, needs to be told. */
export interface ReadSessionInputs {
  program: Program
  programSession: ProgramSession
  /** The user's local date. */
  todayStr: string
  /** `automatic` programs only: the program's phases (empty otherwise). */
  allPhases: ProgramPhase[]
  /** `automatic` programs only: completed sessions of THIS session since the program started. */
  thisSessionCount: number
  /** `ai_dynamic` only: the session's stored periodization, already served (and fitted to the check-in budget where that applies). */
  periodization: SessionPeriodization | null
  programDeload: ProgramDeloadCheck | null
  /** A workout of this type is under way (`sessionUnderWayCheck`): its plan keeps driving the bar. */
  underWay?: boolean
  loggedTodayInThisSession: Set<string>
  shared: SharedSessionBuildCtx
}

export interface ReadSessionResult {
  exercises: WorkoutExercise[]
  phaseStatus: PhaseStatus | null
  aiPrescription: AiPrescription | null
  aiPrescriptionPending: boolean
  aiDrivesLoad: boolean
  isBaselinePhase: boolean
}

function syntheticPhaseStatus(name: 'Baseline' | 'Deload', phaseType: 'baseline' | 'deload'): PhaseStatus {
  return {
    phase: { id: '', phaseSetId: '', position: 0, name, durationCycles: 1, phaseType } as ProgramPhase,
    cycleInPhase: 1,
    totalPhaseCycles: 1,
    completedCycles: 0,
    totalProgramCycles: 0,
    sessionsPerCycle: 1,
    sessionsInCurrentCycle: 0,
    blockComplete: false,
    approxWeeksRemaining: null,
    isDeloadActive: phaseType === 'deload',
    isBaseline: phaseType === 'baseline',
    openEnded: true,
    phaseSessionNumber: 1,
  }
}

/** What phase resolution is told. The same inputs for every reader of a session. */
export interface SessionPhaseInputs {
  program: Program
  /** The user's local date. */
  todayStr: string
  /** `automatic` programs only: the program's phases (empty otherwise). */
  allPhases: ProgramPhase[]
  /** `automatic` programs only: completed sessions of THIS session since the program started. */
  thisSessionCount: number
  /** `ai_dynamic` only: the session's stored periodization. */
  periodization: SessionPeriodization | null
  /** The pre-workout Full/Deload toggle (`?aiDeload=1`). Only the session screen's own read has one. */
  aiDeload?: boolean
}

export interface SessionPhase {
  currentPhase: ProgramPhase | null
  phaseStatus: PhaseStatus | null
  isBaselinePhase: boolean
}

/**
 * The ONE resolution of which phase a session is in: an automatic program's phase, an ai_dynamic
 * baseline, and a confirmed early-deload week (from Home, or the pre-workout toggle). The session
 * screen's single-session read, its `?tab=all` batch and the Next workout card all call this before
 * they build anything, so none of them holds its own copy (#4019).
 */
export function resolveSessionPhase(i: SessionPhaseInputs): SessionPhase {
  const { program, todayStr, allPhases, periodization } = i
  const isAutomatic = program.phaseMode === 'automatic'
  const isAiDynamic = program.phaseMode === 'ai_dynamic'
  const sessionPerWeek = getScheduledSessionsPerWeek(program) / Math.max(1, program.sessions.length)

  let currentPhase: ProgramPhase | null = null
  let phaseStatus: PhaseStatus | null = null
  if (isAutomatic && allPhases.length > 0) {
    phaseStatus = buildAutomaticPhaseStatus(allPhases, i.thisSessionCount, program, todayStr, sessionPerWeek)
    currentPhase = phaseStatus.phase
  }

  // BF-148 — a row still reading `baseline && !baselineComplete` means what it says.
  const isAiDynamicBaseline = isAiDynamic
    && periodization?.phase === 'baseline'
    && !periodization?.baselineComplete

  const isBaselinePhase = currentPhase?.phaseType === 'baseline' || isAiDynamicBaseline

  // The app has two deload-confirmation entry points and they converge here: the toggle and Home's
  // "Take deload week now" (`programs.earlyDeloadWeekStart`).
  const deloadNow = i.aiDeload === true || isEarlyDeloadWeek(program, todayStr)

  // Surface isBaseline to the client for AI Dynamic programs so the workout shows the AMRAP banner.
  if (isAiDynamicBaseline && !phaseStatus) phaseStatus = syntheticPhaseStatus('Baseline', 'baseline')

  if (deloadNow && isAiDynamic && !phaseStatus) {
    phaseStatus = syntheticPhaseStatus('Deload', 'deload')
  } else if (deloadNow && isAiDynamic && phaseStatus) {
    phaseStatus = { ...phaseStatus, isDeloadActive: true }
  }

  // Not baseline, not a confirmed deload: still an explicit phaseStatus, so the client can clear a
  // stale baseline from its cache. The engine-chosen `phase: 'deload'` lands here too.
  if (isAiDynamic && !phaseStatus && periodization) {
    phaseStatus = aiDynamicFallbackPhaseStatus(periodization)
  }

  return { currentPhase, phaseStatus, isBaselinePhase }
}

/**
 * One program session's exercises as the session screen builds them, from stored state alone: no
 * re-evaluation against today's signals, no regeneration, no write, no `?aiDeload` toggle. The ONE
 * resolution of phase, baseline, deload, the AI plan and its pending state that feeds
 * `buildWorkoutExercises`, so a reader that cannot run the screen's live steps gets the same numbers
 * the screen starts from. Called by `/api/workout-data?tab=all` (every session) and by
 * `/api/next-session/prescription` (the Next workout card).
 */
export function readSessionFromStoredState(i: ReadSessionInputs): ReadSessionResult {
  const { program, programSession, allPhases, periodization, programDeload } = i
  const isAiDynamic = program.phaseMode === 'ai_dynamic'

  // A confirmed early-deload week is the only deload signal a stored-state read can see, so no toggle.
  const { currentPhase, phaseStatus, isBaselinePhase } = resolveSessionPhase({
    program, todayStr: i.todayStr, allPhases, thisSessionCount: i.thisSessionCount, periodization,
  })

  const aiPrescription = isAiDynamic && !isBaselinePhase && periodization?.prescription
    ? normalizeStoredPrescription(
        periodization.prescription, periodization.phase,
        new Map(programSession.exercises.map(ex => [ex.id, ex.exerciseRole])),
      )
    : null
  const aiPrescriptionPending = isAiPrescriptionPending(periodization, { isAiDynamic, isBaselinePhase, programDeload, underWay: i.underWay })
  // An aged-out prescription is pending regeneration, not the plan (#3700).
  const aiDrivesLoad = aiPrescription != null && periodization != null && !aiPrescriptionPending
    && prescriptionDrivesLoad(aiPrescription.phaseAction, periodization.prescriptionStatus)

  const aiPhaseLabel = aiPrescription ? capitalize(aiPrescription.phase) : ''
  const droppedThisCycle = new Set(aiDrivesLoad ? (aiPrescription!.droppedExerciseIds ?? []) : [])

  const exercises = buildWorkoutExercises(programSession, {
    ...i.shared,
    currentPhase,
    allPhases,
    isDeloadActive: phaseStatus?.isDeloadActive ?? false,
    isBaselinePhase,
    aiDrivesLoad,
    aiPrescription,
    aiPhaseLabel,
    isAiDynamic,
    aiDeload: false,
    droppedThisCycle,
    loggedTodayInThisSession: i.loggedTodayInThisSession,
    trainingGoal: program.trainingGoal,
  })

  return { exercises, phaseStatus, aiPrescription, aiPrescriptionPending, aiDrivesLoad, isBaselinePhase }
}
