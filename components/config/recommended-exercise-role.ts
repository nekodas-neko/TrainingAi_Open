import { recommendAddedExerciseRole } from '@trainingai/shared/workout/exercise-role'
import type { ExerciseLibraryEntry, ExerciseRole } from '@trainingai/shared/types/program'

/**
 * BF-15 — the role a newly-identified exercise should start on.
 *
 * The editor adds an EMPTY slot, so nothing is known about it at that moment; the role can only be
 * recommended once a name resolves to a catalogue entry. That is `selectExerciseName`, which both
 * the picker and free-text entry funnel through.
 *
 * Two rules, and both are the point:
 * - **Never overwrite a role the lifter chose.** The recommendation is a starting pill, not a
 *   correction — renaming an exercise that already carries a role leaves it alone.
 * - **An unknown name gets no recommendation**, because `recommendAddedExerciseRole` reads the
 *   catalogue's muscle count and a name it cannot find has none. The fallback
 *   (`UNCLASSIFIED_EXERCISE_ROLE`) already covers that case, and is what BF-15's engine half fixed.
 */
export interface RoleSlot { exerciseRole?: ExerciseRole }
export interface RoleSession { exercises: RoleSlot[]; timeBudgetMinutes?: number }

/** The session's default length when none is configured — the editor's own stepper default. */
const DEFAULT_BUDGET_MINUTES = 60

export function roleForSelectedExercise(
  match: ExerciseLibraryEntry | undefined,
  session: RoleSession | undefined,
  ei: number,
): ExerciseRole | undefined {
  const current = session?.exercises[ei]?.exerciseRole
  if (current != null) return current
  if (!match) return undefined
  return recommendAddedExerciseRole(
    { muscleCount: match.muscles.length, equipment: match.equipment },
    (session?.exercises ?? [])
      .filter((_, j) => j !== ei)
      .map(e => e.exerciseRole)
      .filter((r): r is ExerciseRole => r != null),
    session?.timeBudgetMinutes ?? DEFAULT_BUDGET_MINUTES,
  )
}

/**
 * The catalogue fields a named exercise adopts. Extracted alongside the role because they are
 * computed from the same `match` and for the same reason — the editor knows nothing about a slot
 * until its name resolves. `undefined` for a name the catalogue does not hold, so the caller keeps
 * whatever the slot already had rather than blanking it.
 */
export function musclesForSelectedExercise(match: ExerciseLibraryEntry | undefined): {
  mainMuscles?: string[]
  secondaryMuscles?: string[]
  muscleGroups?: string[]
} {
  if (!match) return {}
  return {
    mainMuscles: match.muscles.filter(m => m.role === 'main').map(m => m.muscle),
    secondaryMuscles: match.muscles.filter(m => m.role === 'secondary').map(m => m.muscle),
    muscleGroups: match.muscles.map(m => m.muscle),
  }
}
