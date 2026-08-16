export type PeriodizationPhase =
  | 'baseline'
  | 'accumulation'
  | 'intensification'
  | 'realisation'
  | 'deload'

export type PrescriptionStatus =
  | 'none'
  | 'pending'
  | 'accepted'
  | 'auto_applied'
  | 'dismissed'
  | 'consumed'

export type TrainingGoal = 'strength' | 'hypertrophy' | 'power' | 'endurance'

export interface Baseline1rmEntry {
  kg: number
  /** `estimate` is a starting 1RM the user typed in the builder (`exercise_estimates`),
   *  kept distinct from `existing` (an earned personal record) so the prescription prompt
   *  can weigh a self-reported number differently from a measured one (Q-5). */
  source: 'amrap' | 'personal_record' | 'existing' | 'estimate'
}

export interface AiPrescriptionExercise {
  sessionExerciseId: string
  name: string
  sets: number
  reps: number
  pct: number
  restSec: number
  // Plain-English note when RPE autoregulation adjusted this exercise's load/reps/sets
  // (e.g. "−7.5% load — RPE ran high while your 1RM slipped"). Absent when unchanged.
  autoregNote?: string
  // Per-exercise deload (mood-log soreness on this exercise's main muscles while the
  // rest of the session trains normally). preDeload keeps the model's original
  // prescription so the user can revert to full weights on the pre-workout screen.
  deloaded?: boolean
  deloadNote?: string
  preDeload?: { sets: number; reps: number; pct: number; restSec: number }
}

export interface PendingTransition {
  newPhase: PeriodizationPhase
  reasoning: string
  urgency: 'normal' | 'high'
}

export interface AiPrescription {
  phase: PeriodizationPhase
  phaseAction: 'stay' | 'transition_recommended' | 'deload_recommended' | 'session_swap_recommended' | 'rest_day_recommended'
  exercises: AiPrescriptionExercise[]
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
  deload: boolean
  reasoning: string
  confidence: number
  // Plain-English factors limiting the engine's confidence (empty/absent when it has full
  // data). Surfaced in the prescription card and the low-confidence confirm step.
  confidenceReasons?: string[]
  // Set only when the engine APPLIED a phase transition automatically (auto-apply on, the
  // model earned it). Built deterministically in transition-rationale.ts from the same
  // thresholds the engine gates on — the lifter's load changed without them pressing
  // anything, so the card must be able to say exactly why. Absent on every other prescription.
  transitionRationale?: string
  // Session-exercise ids the Workout Review dropped for THIS cycle only (a reversible
  // overlay — the exercise stays in the program). Render paths that show what you'll
  // train today (workout-data, the home recommendation) skip these ids; the exercise
  // reappears once the prescription is regenerated. Permanent drops delete the row
  // instead and never populate this. Absent/empty on ordinary prescriptions.
  droppedExerciseIds?: string[]
  // Which time budget this plan was built for. Absent/'standard' = the session's own
  // configured timeBudgetMinutes. Set when the lifter explicitly asked for a shorter or
  // longer session today, so the pre-workout control can show which one is live — the
  // choice itself is never persisted on the program, only here, on the plan it produced.
  durationPreset?: 'short' | 'standard' | 'long'
  // Fingerprint of the inputs consumption-day re-evaluation
  // (lib/ai-periodization/reevaluate.ts) last ran against — see reevaluationKey(). Lets
  // workout-data skip re-running it on every fetch while still re-running the moment the
  // soreness/injury inputs actually change. A plain date was not enough: the first read of
  // the day stamped it, so a check-in logged afterwards (the normal order — open the app,
  // then log how you feel) could never take effect. Absent on a freshly-generated
  // prescription (generation already evaluated the current inputs).
  reevaluatedInputsKey?: string
}

export interface SessionPeriodization {
  id: string
  userId: string
  programSessionId: string
  phase: PeriodizationPhase
  phaseStartedAt: Date
  sessionsInPhase: number
  baselineComplete: boolean
  baseline1rm: Record<string, Baseline1rmEntry>
  prescription: AiPrescription | null
  prescriptionGeneratedAt: Date | null
  prescriptionExpiresAt: Date | null
  prescriptionStatus: PrescriptionStatus
  lastSessionRanPrescription: boolean | null
  pendingTransition: PendingTransition | null
  preEmergencyDeloadPhase: PeriodizationPhase | null
  updatedAt: Date
}

export interface ProgramVolumeTarget {
  id: string
  programId: string
  muscleGroup: string
  targetSetsPerWeek: number
}
