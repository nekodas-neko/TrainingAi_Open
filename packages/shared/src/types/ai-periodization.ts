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

/** What a generation's plan was made for, checked when it is stored: the slot's phase and start
 *  (#3766) and, when given, the session's structure stamp (#3895). A plan whose slot moved on, or
 *  whose session was changed while it was being made, is not stored. */
export interface PrescriptionGeneratedFor {
  phase: PeriodizationPhase
  phaseStartedAt: Date
  structure?: string | null
}

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
  /** A scheduled move: the current block ends after this many training weeks instead of the phase's
   *  standard cap (#3766's switch-over writes 3 on every row). Any phase move clears it. */
  afterTrainingWeeks?: number
  /** #3766: the program is on one phase. Every program move writes it on every row, and so does the
   *  first read of a program that already shared one phase. A program that carries it never runs the
   *  switch-over again: a later disagreement between its rows is re-aligned to the program's phase. */
  programPhase?: true
  /** #3766: the program is waiting for its one-time switch-over to one phase. Written on every row on
   *  the first read after the rule shipped, and kept by a per-type move during the wait. */
  switchOverPending?: true
  /** #3766: while waiting, the local Monday ("YYYY-MM-DD") the switch-over starts on, fixed as soon as
   *  the last deload finishes, so a type leaving its deload afterwards cannot lose it. */
  switchOverOn?: string
  /** #3876: when `switchOverOn` was first known (ISO instant). A type that enters or restarts a
   *  deload after it no longer holds the switch-over or moves its date later. */
  switchOverKnownAt?: string
}

/** A prescription's two whole-session figures (`prescriptionFigures` computes both). */
export interface PrescriptionFigures {
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
}

export interface AiPrescription {
  phase: PeriodizationPhase
  /** `rest_day_recommended` is only ever read from a row stored before #3718; nothing writes it now,
   *  and `prescriptionAgedOut` treats such a row as stale, never as the plan. */
  phaseAction: 'stay' | 'transition_recommended' | 'deload_recommended' | 'session_swap_recommended' | 'rest_day_recommended'
  /** #3766: the move on offer is this session type's own (a deload's way out while the program waits
   *  for its switch-over to one phase), so the screens do not call it the program's. Absent: a
   *  transition is the program's. */
  typeOnlyMove?: true
  exercises: AiPrescriptionExercise[]
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
  /**
   * The same two figures for the session the `Full` override trains — every deloaded row put back
   * on its `preDeload` numbers (#2403). The stored figures above describe the deload; under Full
   * the card, its pills and the time picker read these instead. Written wherever `preDeload` is
   * (the whole-session deload builder, the model path's per-exercise deload, the budget re-fit) and
   * only when some row has one. Absent — every prescription stored before this, and any with
   * nothing to revert — the surfaces fall back to the stored figures. Consumption-day re-evaluation (issue 2592) re-costs the stored figures when it moves rows, but its value
   * is unchanged by that: moving a row between deloaded and full keeps `preDeload` equal to its
   * full numbers, so the session Full trains is unchanged.
   */
  fullSession?: PrescriptionFigures
  deload: boolean
  reasoning: string
  confidence: number
  // Plain-English factors limiting the engine's confidence (empty/absent when it has full
  // data). Surfaced in the prescription card and the low-confidence confirm step.
  confidenceReasons?: string[]
  /**
   * Where this plan's numbers came from. Absent or `'model'` on everything generated before
   * RV-202 and on every successful generation since.
   *
   * `'rules'` means the model call failed and the plan was built from the lifter's own
   * progression style instead — sound numbers, but with no phase transition, no RPE
   * autoregulation and no per-exercise deload, because those are the parts only the model does.
   * It answers 200 rather than the old 502: the client polled that ten times at 3 s and then
   * fell back to the base program anyway, so the lifter waited ~30 s to arrive where this
   * arrives immediately.
   *
   * `workout-data` passes it on as `prescriptionSource` while the plan drives load, and the
   * pre-workout heading labels a rules plan "From your program" (#2110).
   */
  source?: 'model' | 'rules'
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
  // BF-7 PR 2b: minutes now, with the three labels still legal because THIS FIELD IS WHERE THEY
  // WERE STORED — 10 of 10 production prescriptions carried one on 2026-09-21. `DurationPreset`
  // resolves both in one place (`requestedBudgetMin`), so nothing that reads this needs to care.
  durationPreset?: import('@trainingai/shared/workout/duration-model').DurationPreset
  sessionTimeBudgetMinutes?: number
  // What a no-model duration re-fit starts from (RV-202 ②). Changing the time budget used to
  // re-run the whole model call for work that is pure arithmetic — the budget stage is
  // deterministic — but it cannot re-run against the STORED plan, because the budget passes
  // only ever remove sets and a return to the session's own length runs neither drop nor
  // expand. Re-fitting a trimmed plan would keep the trimmed sets and relabel them, so the
  // pre-budget shape is kept here instead, the same way `preDeload` keeps a revertible
  // snapshot per exercise. Absent on every prescription generated before this shipped, and on
  // whole-session deloads (which are returned unchanged while they are pending) — both fall
  // back to a full generation.
  refitBaseline?: {
    /** Set count per sessionExerciseId BEFORE the budget stage. reps/pct are never touched by the
     *  stage, so those are read off the exercise itself. */
    sets: Record<string, number>
    /** Rest per sessionExerciseId BEFORE the budget stage, present only when the stage shortened
     *  one (#2284, a shorter-than-usual session). Without it a re-fit back to the session's own
     *  length would start from the shortened rest and keep it. */
    restSec?: Record<string, number>
    /** The reasoning before the stage appended its dropped/overrun note, so a re-fit replaces
     *  that note rather than stacking a second one on top of it. */
    reasoning: string
    /** Exercises that earned a set through RPE autoregulation — trimmed last, so the re-fit
     *  protects them exactly as the generation that produced them did. */
    earnedSetIds?: string[]
    /** The phase the generation's budget stage capped the sets against, i.e. the phase the loads
     *  were written for (#3713). A cap guard can rewrite `phase` to the NEXT phase afterwards while
     *  the loads stay this one's, so a re-fit reads this, never `phase`. Absent before #3713:
     *  `phaseOfLoads` falls back. */
    phase?: PeriodizationPhase
  }
  // Fingerprint of the inputs consumption-day re-evaluation
  // (lib/ai-periodization/reevaluate.ts) last ran against — see reevaluationKey(). Lets
  // workout-data skip re-running it on every fetch while still re-running the moment the
  // soreness/injury inputs actually change. A plain date was not enough: the first read of
  // the day stamped it, so a check-in logged afterwards (the normal order — open the app,
  // then log how you feel) could never take effect. Absent on a freshly-generated
  // prescription (generation already evaluated the current inputs).
  reevaluatedInputsKey?: string
  /** #3876: the type's `sessionsInPhase` when generation stored this plan. A plan in a finished
   *  deload made before the count got there is regenerated (`deloadEndDue`); absent on plans
   *  stored before this field, which are regenerated once. */
  sessionsInPhaseAtPlan?: number
  /** #3876: on an aligned program, the program's `trainingWeeksDone` when generation stored this
   *  plan. An aligned deload ends at the program's cap, which can be reached with no new session (a
   *  plan made on the deload week's last day is read the week after), so a plan in a finished
   *  program deload made before the cap is regenerated (`deloadEndDue`). */
  programWeeksDoneAtPlan?: number
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
