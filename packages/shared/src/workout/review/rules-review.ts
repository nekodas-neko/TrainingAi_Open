import {
  applyRoleSetPlausibility,
  dropToBudget,
} from '@trainingai/shared/ai-periodization/time-budget'
import {
  buildBudgetMuscleVolume,
  buildTimedExercises,
  type BudgetStageExercise,
} from '@trainingai/shared/ai-periodization/budget-stage'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { ReviewModelExercise } from '@trainingai/shared/workout/review/reconcile'

/**
 * RV-204 — the Workout Review without a model call.
 *
 * The review asked Gemini which exercises to drop and which sets to change, and then handed the
 * answer to `reconcileReview`, which clamps every number, refuses unsafe drops, back-fills what
 * the model omitted and recomputes duration and weekly volume. What the model actually supplied
 * that survived was the *choice*, plus a sentence of prose per drop.
 *
 * That choice already exists deterministically, and the prescription path makes it on every
 * session: `applyRoleSetPlausibility` → `fitToBudget` → `dropToBudget`, ordered by
 * `trimPriority`, which weighs each cut against the muscle's weekly target. Running it here is
 * what makes a review and a prescription AGREE — before this, the review could propose a shape
 * the prescription would never generate, with no way to tell which was right.
 *
 * **Where this is deliberately weaker than the model: the free-text drop reason.**
 * `reconcileReview` already falls back to `'Dropped to fit the time budget.'`, which is the true
 * reason in every case this produces one — nothing here drops for any other cause.
 *
 * **And where it is deliberately stronger:** `dropToBudget` runs whenever the session overruns
 * after its sets are floored. `applyBudgetStage` declines to drop unless the user explicitly
 * asked for a SHORT session, because there the under-fill is the finish-early margin; a review
 * is the opposite situation — the user opened it to be told what does not fit.
 */
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

  // `dropToBudget` IS "trim first, then drop": it runs `fitToBudget` itself and only enters its
  // drop loop while the trimmed session is still over. So sets remain the cheap lever and a whole
  // exercise remains the last resort, with no guard needed here to sequence them — an earlier
  // version had one and the mutation pass proved it could never change an answer.
  const dropped = dropToBudget(plausible, budgetMin, new Set(), muscleVolume)
  const droppedIds = new Set(dropped.droppedIds)
  const finalSets = new Map(dropped.exercises.map(t => [t.sessionExerciseId, t.sets]))

  const modelExercises: ReviewModelExercise[] = []
  for (const ex of exercises) {
    const name = ex.name
    if (droppedIds.has(ex.sessionExerciseId)) {
      modelExercises.push({
        sessionExerciseId: ex.sessionExerciseId, name, action: 'drop',
        sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.restSec,
        // Left undefined on purpose: `reconcileReview` supplies the fallback string, so the
        // sentence lives in ONE place rather than being duplicated here.
        dropReason: undefined,
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
    parts.push(`${names} ${dropCount === 1 ? 'does' : 'do'} not fit the ${budgetMin}-min working budget even at minimum sets, so ${dropCount === 1 ? 'it is' : 'they are'} dropped for today — the muscles furthest ahead of their weekly target go first.`)
  }
  if (adjusted > 0) {
    parts.push(`${adjusted} ${adjusted === 1 ? 'exercise has its' : 'exercises have their'} set count trimmed to fit the ${budgetMin}-min working budget.`)
  }
  if (parts.length === 0) {
    parts.push(`This session already fits its ${budgetMin}-min working budget, so nothing is changed.`)
  }

  return { modelExercises, reasoning: parts.join(' ') }
}
