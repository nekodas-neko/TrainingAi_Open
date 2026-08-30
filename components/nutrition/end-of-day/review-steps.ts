/**
 * Which steps the evening wrap-up shows (Q-112b).
 *
 * The plan states the rule once so it is not re-decided per section: a step renders as a **prompt**
 * when it has an unanswered question, as a **summary** when it does not, and is **omitted** when it
 * has neither — no data and nothing to ask for. Step 1 is never omitted.
 *
 * Only the meals step is actually conditional today, which makes this module small; it exists
 * anyway because the predicate is "*no* meal type is empty", and a negated quantifier is exactly the
 * kind of expression that gets inverted in a refactor and then looks plausible either way.
 */
export type ReviewStepId = 'day' | 'meals' | 'wrapUp'

export const ALL_REVIEW_STEPS: ReviewStepId[] = ['day', 'meals', 'wrapUp']

export interface StepInput {
  /** The user's configured meal types. Empty means nothing is configured yet. */
  mealTypes: { id: string }[]
  /** `mealTypeId` of every food log on the day. Duplicates are fine. */
  loggedMealTypeIds: string[]
}

/** True when at least one configured meal type has nothing logged against it. */
export function hasUnloggedMeal({ mealTypes, loggedMealTypeIds }: StepInput): boolean {
  if (mealTypes.length === 0) return false
  const logged = new Set(loggedMealTypeIds)
  return mealTypes.some(mt => !logged.has(mt.id))
}

export function visibleReviewSteps(input: StepInput): ReviewStepId[] {
  const steps: ReviewStepId[] = ['day']
  if (hasUnloggedMeal(input)) steps.push('meals')
  steps.push('wrapUp')
  return steps
}

export const STEP_TITLES: Record<ReviewStepId, string> = {
  // "The day", not "Your day": the digest card on this very step carries a "Your day" eyebrow, and
  // two nodes reading the same words on one screen is the LB-23 shape — redundant to a screen reader
  // and ambiguous to a locator. Verified by screenshot at 412 dp before renaming.
  day: 'The day',
  meals: 'Anything missed?',
  wrapUp: 'How it felt',
}
