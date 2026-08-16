import { moodMuscleMatches } from '@trainingai/shared/muscles'
import { deloadOverrideForGoal, type DeloadOverride } from '@trainingai/shared/ai-periodization/deload-constants'

// Deterministic per-exercise deload — the muscle-soreness quadrant.
//
// Mood-log soreness (soreMusclesInSession) is matched against each exercise's
// MAIN-role muscle assignments only. Half or fewer of the session's exercises
// affected → deload just those in place; more than half → the caller should
// offer a whole-session deload instead. Runs before the LLM call: the
// prescription for a deloaded exercise is overwritten after parsing, so the
// model can never fight it.

export interface PerExerciseDeloadInput {
  sessionExerciseId: string
  name: string
  muscleAssignments: Array<{ muscle: string; role: 'main' | 'secondary' }>
}

export interface PerExerciseDeloadResult {
  outcome: 'none' | 'per_exercise' | 'whole_session'
  deloadedIds: Set<string>
  notes: Record<string, string>
  // Sore mood-log labels that matched at least one main-role assignment,
  // deduped — feeds note text here and the whole-session offer's reasoning.
  matchedMuscles: string[]
  override: DeloadOverride
}

export function computePerExerciseDeload(
  exercises: PerExerciseDeloadInput[],
  soreMusclesInSession: string[],
  trainingGoal: string,
  phase: string,
): PerExerciseDeloadResult {
  const override = deloadOverrideForGoal(trainingGoal)
  const none: PerExerciseDeloadResult = {
    outcome: 'none',
    deloadedIds: new Set(),
    notes: {},
    matchedMuscles: [],
    override,
  }
  if (phase === 'deload') return none
  if (exercises.length === 0 || soreMusclesInSession.length === 0) return none

  const matchedMuscles = new Set<string>()
  const affected: Array<{ id: string; sore: string[] }> = []

  for (const ex of exercises) {
    const sore = soreMusclesInSession.filter(label =>
      ex.muscleAssignments.some(ma => ma.role === 'main' && moodMuscleMatches(ma.muscle, label)),
    )
    if (sore.length === 0) continue
    sore.forEach(s => matchedMuscles.add(s))
    affected.push({ id: ex.sessionExerciseId, sore })
  }

  if (affected.length === 0) return none

  if (affected.length * 2 > exercises.length) {
    return { ...none, outcome: 'whole_session', matchedMuscles: [...matchedMuscles] }
  }

  const notes: Record<string, string> = {}
  for (const a of affected) {
    const labels = a.sore.map(s => s.toLowerCase()).join(' & ')
    notes[a.id] = `Deload — ${labels} still sore`
  }

  return {
    outcome: 'per_exercise',
    deloadedIds: new Set(affected.map(a => a.id)),
    notes,
    matchedMuscles: [...matchedMuscles],
    override,
  }
}
