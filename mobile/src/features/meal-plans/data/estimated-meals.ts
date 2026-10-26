import { localClockTimeToDate } from '@trainingai/shared/date-utils';
import { slotCloseHour } from '@trainingai/shared/nutrition/meal-estimate';
import { planMealTypeId } from '@trainingai/shared/nutrition/meal-type-for-time';
import type { MealType } from '@trainingai/shared/types/nutrition';
import type { MealPlan } from '../../nutrition/data/models.ts';

// Estimated meals (#2123). A plan meal whose slot has passed with nothing logged is assumed eaten
// (#2122) and counts toward the day's ring until the owner answers. These are the pure rules for
// showing that assumption and for the reminder that asks about it; the writes are in
// `resolve-estimate.ts`.
export type PlanMeal = MealPlan['variants'][number]['meals'][number];
type Answer = { planMealId: string; answer?: string; [key: string]: unknown };
type LogLike = { mealTypeId: string };
type TypeLike = Pick<MealType, 'id' | 'name' | 'timeEndHour' | 'remindersEnabled'>;
const types = (list: readonly TypeLike[]) => list as unknown as MealType[];

/** The kcal the app assumed for an `estimated` answer, else null. */
export function estimateKcal(answer: Answer | undefined) {
  if (answer?.answer !== 'estimated') return null;
  const kcal = answer.estCalories;
  return typeof kcal === 'number' && kcal > 0 ? Math.round(kcal) : null;
}

export type EstimatedMeal = {
  meal: PlanMeal & { id: string };
  mealTypeId: string;
  mealTypeName: string;
  kcal: number;
};

/**
 * The meals whose estimate is counting right now. An estimate counts only while its meal type has
 * nothing logged (`countedEstimates`, shared): logging anything of that type supersedes it, so the
 * row goes too. A meal the plan no longer places is left out, as the ring leaves it out.
 */
export function estimatedMeals(input: {
  meals: readonly PlanMeal[];
  answers: readonly Answer[];
  logs: readonly LogLike[];
  mealTypes: readonly TypeLike[];
}): EstimatedMeal[] {
  const logged = new Set(input.logs.map((log) => log.mealTypeId));
  const out: EstimatedMeal[] = [];
  for (const meal of input.meals) {
    if (!meal.id) continue;
    const kcal = estimateKcal(input.answers.find((a) => a.planMealId === meal.id));
    const mealTypeId = planMealTypeId(meal, types(input.mealTypes));
    if (kcal === null || !mealTypeId || logged.has(mealTypeId)) continue;
    const type = input.mealTypes.find((t) => t.id === mealTypeId);
    out.push({
      meal: { ...meal, id: meal.id },
      mealTypeId,
      mealTypeName: type?.name ?? meal.name,
      kcal,
    });
  }
  return out;
}

/** The line that keeps the assumption visible wherever an estimated meal appears. */
export function assumedLine(mealName: string, kcal: number) {
  return `Assumed: ${mealName}, 1 serving · ${Math.round(kcal)} kcal`;
}

/** Plan meals to offer under "From your plan": not the estimated one, with ingredients to log, and
 *  not already recorded. */
export function planPickerMeals(
  meals: readonly PlanMeal[],
  excludeId: string,
  recorded: (meal: PlanMeal) => boolean,
) {
  return meals.filter((meal) => meal.id !== excludeId && meal.ingredients.length > 0 && !recorded(meal));
}

export type MealEstimateReminder = {
  planMealId: string;
  /** The local day the reminder is for. */
  date: string;
  /** When the slot is over, as epoch ms. */
  at: number;
  mealTypeName: string;
  mealName: string;
  kcal: number;
};

/**
 * The reminders that ask about today's meals once their slot is over. Only for meal types whose
 * "Meal reminders" switch is on, only while the meal is still unanswered (nothing of its type
 * logged, no decline), and only for meals the sheet can act on (they have ingredients to log).
 * `kcal` is the plan's target, not the stored estimate, so the reminder's text (and so its
 * signature) does not change when the estimate appears beside it.
 */
export function estimateReminders(input: {
  date: string;
  tz: string;
  meals: readonly PlanMeal[];
  answers: readonly Answer[];
  logs: readonly LogLike[];
  mealTypes: readonly TypeLike[];
}): MealEstimateReminder[] {
  const logged = new Set(input.logs.map((log) => log.mealTypeId));
  const out: MealEstimateReminder[] = [];
  for (const meal of input.meals) {
    if (!meal.id || !meal.ingredients.length || !(meal.targetCalories > 0)) continue;
    const mealTypeId = planMealTypeId(meal, types(input.mealTypes));
    const type = input.mealTypes.find((t) => t.id === mealTypeId);
    if (!type?.remindersEnabled || logged.has(type.id)) continue;
    const answer = input.answers.find((a) => a.planMealId === meal.id);
    if (answer && answer.answer !== 'estimated') continue;
    const close = slotCloseHour(type.timeEndHour, meal.suggestedTime);
    if (close === null) continue;
    const minutes = close >= 24 ? 23 * 60 + 59 : Math.round(close * 60);
    const clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const at = localClockTimeToDate(input.date, clock, input.tz);
    if (!at) continue;
    out.push({
      planMealId: meal.id,
      date: input.date,
      at: at.getTime(),
      mealTypeName: type.name,
      mealName: meal.name,
      kcal: Math.round(meal.targetCalories),
    });
  }
  return out;
}

/** The notification's own words, as the owner approved them. */
export function reminderText(reminder: MealEstimateReminder) {
  return {
    title: `${reminder.mealTypeName}: ${reminder.mealName}, 1 serving`,
    body: `Counted as about ${reminder.kcal} kcal until you answer.`,
  };
}

/** Which of the reminder's actions was pressed; the body tap and anything unknown are `open`. */
export type EstimateAction = 'ate' | 'else' | 'skipped' | 'open';
export const ESTIMATE_ACTION_IDS = { ate: 'meal-ate', else: 'meal-else', skipped: 'meal-skipped' } as const;
export function estimateActionFrom(identifier: unknown): EstimateAction {
  const pressed = (Object.keys(ESTIMATE_ACTION_IDS) as Exclude<EstimateAction, 'open'>[]).find(
    (action) => ESTIMATE_ACTION_IDS[action] === identifier,
  );
  return pressed ?? 'open';
}

/** A request to answer one plan meal, from a reminder's action or a tap on its body. `id` makes
 *  each request count once. */
export type EstimateRequest = { id: string; planMealId: string; action: EstimateAction };
