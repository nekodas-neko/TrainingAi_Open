import type { ProgramPhaseType } from './program'

import type { RpeSource } from '../workout/rpe-source'
export type { RpeSource }

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
  /** #2445: the bar prescribed for this set after plate rounding (`set_logs.planned_weight_kg`). */
  plannedWeightKg?: number
  /** #2450: whether `rpe` was tapped or left at the pre-fill (`set_logs.rpe_source`). */
  rpeSource?: RpeSource
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
  /** `exercise_library.exercise_type` via `exercise_id`, null when the log has none. Decides a
   *  display unit — see `isBodyweightType` in `1rm.ts` (RV-219). */
  exerciseType?: string | null
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
