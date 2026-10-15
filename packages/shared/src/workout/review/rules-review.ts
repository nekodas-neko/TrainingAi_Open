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
import type { ReviewModelExercise, ReviewProposal, ReviewProposalExercise } from '@trainingai/shared/workout/review/reconcile'


/**
 * The sheet's summary line. One writer for the text, so the allocator's draft and the final,
 * reconciled proposal cannot word the same outcome two ways.
 */
function summarizeReview(params: {
  budgetMin: number
  droppedNames: string[]
  adjustedCount: number
  /** Exercises the allocator dropped but a guard in `reconcileReview` kept. */
  protectedNames: string[]
}): string {
  const { budgetMin, droppedNames, adjustedCount, protectedNames } = params
  const parts: string[] = []
  if (droppedNames.length > 0) {
    parts.push(`${droppedNames.join(', ')} ${droppedNames.length === 1 ? 'is' : 'are'} dropped for today to fit the ${budgetMin}-min working budget: whole exercises go before any sets are cut.`)
  }
  if (adjustedCount > 0) {
    parts.push(budgetMin === 0
      ? 'Set counts adjusted to match exercise roles; no time limit applied.'
      : `${adjustedCount} ${adjustedCount === 1 ? 'exercise has its' : 'exercises have their'} set count trimmed to fit the ${budgetMin}-min working budget.`)
  }
  if (protectedNames.length > 0) {
    parts.push(`${protectedNames.join(', ')} ${protectedNames.length === 1 ? 'stays' : 'stay'} in despite the budget, to protect your training.`)
  }
  if (parts.length === 0) {
    parts.push(budgetMin === 0 ? 'No time limit is set; all exercises are kept.' : `This session already fits its ${budgetMin}-min working budget, so nothing is changed.`)
  }
  return parts.join(' ')
}

/**
 * The summary for what the user is actually shown. `buildRulesReview` only knows what the
 * allocator wanted; `reconcileReview` may keep some of those drops (last primary, last cover of an
 * under-target muscle). Written from the reconciled proposal, the line and the rows agree.
 */
export function summarizeReconciledReview(proposal: ReviewProposal): string {
  const names = (pick: (e: ReviewProposalExercise) => boolean) => proposal.exercises.filter(pick).map(e => e.name)
  return summarizeReview({
    budgetMin: proposal.budgetMin,
    droppedNames: names(e => e.action === 'drop'),
    adjustedCount: proposal.exercises.filter(e => e.action === 'adjust').length,
    protectedNames: names(e => e.action === 'keep' && e.guardAdjusted),
  })
}

export interface RulesReviewResult {
  modelExercises: ReviewModelExercise[]
  /** The allocator's own draft of the summary. The route replaces it with `summarizeReconciledReview` once the guards have run. */
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

  const reasoning = summarizeReview({
    budgetMin,
    droppedNames: exercises.filter(ex => droppedIds.has(ex.sessionExerciseId)).map(ex => ex.name),
    adjustedCount: modelExercises.filter(m => m.action === 'adjust').length,
    protectedNames: [],
  })

  return { modelExercises, reasoning }
}
