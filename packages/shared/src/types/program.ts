export interface MuscleAssignment {
  muscle: string
  role: 'main' | 'secondary'
}

export type ExerciseType = 'weighted' | 'bodyweight'

export interface ExerciseLibraryEntry {
  id: string
  name: string
  muscles: MuscleAssignment[]
  equipment: string[]
  instructions?: string
  createdBy?: string
  exerciseType: ExerciseType
  /** Set when a data migration merged this catalogue entry into another (Q-26) — the row is kept
   *  for FK validity, but a picker must not offer it for a new selection. */
  mergedInto?: string
}

export type ExerciseRole = 'primary' | 'secondary' | 'accessory'

export type ProgramPhaseType = 'normal' | 'peak' | 'deload' | 'accessory' | 'testing' | 'baseline'

export interface ProgramPhase {
  id: string
  phaseSetId: string
  position: number
  name: string
  durationCycles: number
  phaseType: ProgramPhaseType
  primaryStyleId?: string
  secondaryStyleId?: string
  primaryStyleName?: string
}

export interface PhaseSet {
  id: string
  name: string
  isDefault: boolean
  ownerProgramId?: string
  templateBaseName?: string
}

export interface PhaseSetWithPhases extends PhaseSet {
  phases: ProgramPhase[]
}

export interface SessionExercise {
  id: string
  sessionId: string
  exerciseName: string
  styleId?: string
  muscleGroups: string[]
  position: number
  exerciseRole: ExerciseRole
  // Exercises sharing a non-null group value within a session alternate as a
  // superset (v1: pairs/groups must be contiguous by position, no shared-rest field).
  supersetGroup?: number | null
}

export interface ProgramSession {
  id: string
  programId: string
  name: string
  position: number
  icon?: string
  timeBudgetMinutes: number
  exercises: SessionExercise[]
}

export interface ScheduleDay {
  dayOfWeek: number
  sessionId?: string
}

export interface Schedule {
  id: string
  programId: string
  type: 'rotation' | 'weekly'
  restAfterN?: number
  days?: ScheduleDay[]
  reminderEnabled?: boolean
  reminderTime?: string | null  // "HH:MM" or null
}

export interface NextSessionRecommendation {
  isRestDay: boolean
  session?: ProgramSession
  // Per-exercise-name muscle assignments (main vs secondary) for `session`'s exercises —
  // populated so the sore-muscle check-in can predict computePerExerciseDeload's whole-session
  // escalation client-side (Q-115-followup) without re-deriving it from the flat
  // SessionExercise.muscleGroups list, which carries no role information.
  muscleAssignmentsByExercise?: Record<string, MuscleAssignment[]>
  reason: string
  reminderEnabled?: boolean
  reminderTime?: string | null
  // ai_dynamic only — undefined for weekly/rotation programs
  deloadOrRestRecommended?: boolean
  deloadStrength?: 'soft' | 'recommended' | 'strong'
  consecutiveTrainingDays?: number
  consecutiveRestDays?: number
  streakWarning?: boolean
  streakBroken?: boolean
  temperatureAlert?: boolean
  // Extended ai_dynamic scoring fields
  weightedComponents?: {
    recovery: { score: number; weight: number }
    balance: { score: number; weight: number }
    freshness: { score: number; weight: number }
  }
  scoredSessions?: Array<{
    session: ProgramSession
    overallScore: number
    recoveryScore: number
    balanceScore: number
    freshnessScore: number
  }>
  hrvWarning?: boolean
  // Signal data for the "Why this?" explain page
  signals?: {
    muscleRecovery: Array<{ muscle: string; pct: number; hoursAgo: number }>
    ouraReadiness: number | null
    sleepTrend: number | null
    hrvTrend: number | null
    energyLevel: string | null
    soreMuscles: string[]
    // Raw temperature-deviation numbers behind `temperatureAlert` (Q-105) — Oura only exposes a
    // deviation from the ring's own baseline, never an absolute value, so this is a °C delta
    // against temperatureAlertThresholdC, not two literal temperatures. The threshold is sent
    // over the wire (rather than imported client-side from TEMP_ALERT_THRESHOLD_C in
    // ai-dynamic.ts) so the UI never needs to import that server-only module, which pulls in the
    // daytime-stress dHRV inference chain.
    temperatureDeviation: number | null
    temperatureBaselineDays: number | null
    temperatureAlertThresholdC: number
  }
}

export interface Program {
  id: string
  userId: string
  name: string
  isActive: boolean
  sessions: ProgramSession[]
  schedule?: Schedule
  createdAt: Date
  updatedAt: Date
  phaseMode: 'manual' | 'automatic' | 'ai_dynamic'
  phaseSetId?: string
  startedAt?: string
  sessionsPerCycle?: number
  earlyDeloadWeekStart?: string
  totalWeeks?: number
  trainingGoal: string
  autoApplyPrescriptions: boolean
}
