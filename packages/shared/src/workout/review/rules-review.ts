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
 * **#2787 (Orchestrator decision, 2026-10-11): the review drops before it trims, like the allocator.**
 * #2133 moved the prescription onto `allocateToBudget`, which drops whole exercises before flooring
 * any. A review that trimmed first could propose "everything at 2 sets" for a session a fresh
 * prescription would cut to fewer exercises at proper sets — the shape the owner called worse
 * training on 2026-09-24 — and put the two paths back in disagreement. So the review drops whole
 * exercises from the session the user has, at the sets they have, in the allocator's value order
 * (least behind the week first, never below MIN_KEPT_EXERCISES, the last drop keeping a pair that
 * fits), and trims sets toward the 2-set floor only if the two it keeps still overrun. It never adds
 * work: the allocator's fill (step 3) has no place in a review.
 *
 * **Each drop says why** on the sheet (`dropReason`): least behind this week, lowest priority when
 * no weekly target covers its muscles, or the pair rule.
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

  // Drop first, at the user's own set counts: `refit` hands the survivors back unchanged, so the
  // loop sheds whole exercises in value order while the session overruns. Only when the two it keeps
  // still overrun are sets trimmed, toward the 2-set floor.
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
