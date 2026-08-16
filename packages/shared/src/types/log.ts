import type { ProgramPhaseType } from './program'

export interface SetLog {
  id: string
  exerciseLogId: string
  setNumber: number
  weightKg: number
  reps: number
  setTimeSec?: number
  restTimeSec?: number
  intensityPct?: number
  useFor1rm: boolean
  setStartMs?: number
  setEndMs?: number
  rpe?: number
  plannedPct?: number
  plannedReps?: number
  plannedRestSec?: number
}

export interface ExerciseLog {
  id: string
  workoutSessionId: string
  exerciseName: string
  styleId?: string
  styleName?: string
  estimated1rm?: number
  target80?: number
  volume?: number
  avgReps?: number
  timeToComplete?: number
  muscleGroups: string[]
  loggedAt: Date
  sets: SetLog[]
  interExerciseRestSec?: number
  prepTimeSec?: number
  exerciseDeloaded?: boolean
}

// Lightweight alternative to WorkoutSession for the exercise-history view — one row
// per logged instance of a single exercise, with just enough session context (name,
// deload flags) to render the history sheet. Avoids hydrating full session/exercise
// trees just to filter down to one exercise's last N logs.
export interface ExerciseHistoryLogRow {
  id: string
  loggedAt: Date
  sessionName: string
  estimated1rm?: number
  volume?: number
  isEarlyDeload: boolean
  phaseType?: ProgramPhaseType
  sets: Pick<SetLog, 'weightKg' | 'reps' | 'intensityPct' | 'rpe'>[]
}

export interface WorkoutSession {
  id: string
  userId: string
  sessionId?: string        // null when the program_session row has been deleted
  sessionName: string
  startedAt: Date
  completedAt?: Date
  exercises: ExerciseLog[]
  phaseId?: string
  phaseType?: ProgramPhaseType
  isEarlyDeload: boolean
  wasOverride: boolean
  intensityMode?: 'full' | 'deload' | null
  sessionRpe?: number | null
}
