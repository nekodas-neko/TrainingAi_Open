import {
  applyRoleSetPlausibility,
  dropToBudget,
  estimateSessionDurationSec,
  fitToBudget,
} from '@trainingai/shared/ai-periodization/time-budget'
import {
  buildBudgetMuscleVolume,
  buildTimedExercises,
  type BudgetStageExercise,
} from '@trainingai/shared/ai-periodization/budget-stage'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { ReviewModelExercise } from '@trainingai/shared/workout/review/reconcile'


export interface RulesReviewResult {
  modelExercises: ReviewModelExercise[]
  /** Deterministic prose for the sheet's summary line, in place of the model's `reasoning`. */
  reasoning: string
}

export function buildRulesReview(params: {
  exercises: BudgetStageExercise[]
  signals: PrescriptionSignals
  budgetMin: number
}): RulesReviewResult {
  const { exercises, signals, budgetMin } = params
  const muscleVolume = buildBudgetMuscleVolume(signals)
  const beforeSets = new Map(exercises.map(ex => [ex.sessionExerciseId, ex.sets]))

  const plausible = applyRoleSetPlausibility(buildTimedExercises(exercises, signals), muscleVolume)

  const dropped = dropToBudget(plausible, budgetMin, new Set(), muscleVolume, { refit: subset => subset.map(e => ({ ...e })) })
  const kept = estimateSessionDurationSec(dropped.exercises) > budgetMin * 60
    ? fitToBudget(dropped.exercises, budgetMin, new Set(), muscleVolume)
    : dropped.exercises
  const droppedIds = new Set(dropped.droppedIds)
  const pairFitIds = new Set(dropped.pairFitIds)
  const finalSets = new Map(kept.map(t => [t.sessionExerciseId, t.sets]))
  const timedById = new Map(plausible.map(t => [t.sessionExerciseId, t]))
  const dropReason = (id: string): string => {
    if (pairFitIds.has(id)) return `Dropped to fit the ${budgetMin}-min budget: the two exercises left fit together, and dropping the next in line would not.`
    const covered = (timedById.get(id)?.muscleGroups ?? []).some(m => muscleVolume.has(m.muscle))
    return covered
      ? `Dropped to fit the ${budgetMin}-min budget: least behind this week.`
      : `Dropped to fit the ${budgetMin}-min budget: lowest priority in the session (no weekly target covers its muscles).`
  }

  const modelExercises: ReviewModelExercise[] = []
  for (const ex of exercises) {
    const name = ex.name
    if (droppedIds.has(ex.sessionExerciseId)) {
      modelExercises.push({
        sessionExerciseId: ex.sessionExerciseId, name, action: 'drop',
        sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.restSec,
        dropReason: dropReason(ex.sessionExerciseId),
      })
      continue
    }
    const after = finalSets.get(ex.sessionExerciseId)
    // An unchanged exercise is omitted entirely — `reconcileReview` reads a missing entry as
    // `keep`, so saying so explicitly would only be a second way to express the same thing.
    if (after == null || after === beforeSets.get(ex.sessionExerciseId)) continue
    modelExercises.push({
      sessionExerciseId: ex.sessionExerciseId, name, action: 'adjust',
      sets: after, reps: ex.reps, pct: ex.pct, restSec: ex.restSec,
    })
  }

  const adjusted = modelExercises.filter(m => m.action === 'adjust').length
  const dropCount = droppedIds.size
  const parts: string[] = []
  if (dropCount > 0) {
    const names = exercises
      .filter(ex => droppedIds.has(ex.sessionExerciseId)).map(ex => ex.name).join(', ')
    parts.push(`${names} ${dropCount === 1 ? 'is' : 'are'} dropped for today to fit the ${budgetMin}-min working budget: whole exercises go before any sets are cut.`)
  }
  if (adjusted > 0) {
    parts.push(`${adjusted} ${adjusted === 1 ? 'exercise has its' : 'exercises have their'} set count trimmed to fit the ${budgetMin}-min working budget.`)
  }
  if (parts.length === 0) {
    parts.push(`This session already fits its ${budgetMin}-min working budget, so nothing is changed.`)
  }

  return { modelExercises, reasoning: parts.join(' ') }
}
