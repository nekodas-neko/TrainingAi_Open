export type ReviewStepId = 'day' | 'meals' | 'wrapUp';
export const ALL_REVIEW_STEPS: ReviewStepId[] = ['day', 'meals', 'wrapUp'];
export interface StepInput {
  mealTypes: {
    id: string;
  }[];
  loggedMealTypeIds: string[];
}
export function hasUnloggedMeal({ mealTypes, loggedMealTypeIds }: StepInput): boolean {
  if (mealTypes.length === 0) return false;
  const logged = new Set(loggedMealTypeIds);
  return mealTypes.some((mt) => !logged.has(mt.id));
}
export function visibleReviewSteps(input: StepInput): ReviewStepId[] {
  const steps: ReviewStepId[] = ['day'];
  if (hasUnloggedMeal(input)) steps.push('meals');
  steps.push('wrapUp');
  return steps;
}
export const STEP_TITLES: Record<ReviewStepId, string> = {
  day: 'The day',
  meals: 'Anything missed?',
  wrapUp: 'How it felt',
};
