import { plural } from '@trainingai/shared/format/plural';
import { text as foldedName } from '@trainingai/shared/nutrition/food-item-identity';
import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload';
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit';
import { z } from 'zod';
import type { Friendship } from './models.ts';

const amount = z.number().finite().nonnegative();
/**
 * `GET /api/friends/[id]/saved-meals`: one entry per saved meal, newest saved first. `meal` is the
 * whole recipe at real weights (a `SharedMeal`, nothing rolled up). `mealId` and `savedAt` are the
 * author's own ids and times and are not used to write anything.
 */
export const friendMealSchema = z.object({
  mealId: z.string(),
  savedAt: z.string(),
  meal: z.object({
    name: z.string(),
    servings: z.number().finite().positive(),
    ingredients: z.array(
      z.object({
        name: z.string(),
        weightG: amount,
        calories: amount,
        proteinG: amount,
        carbsG: amount,
        fatG: amount,
      }),
    ),
    rolled: amount.default(0),
  }),
});
export type FriendMeal = z.infer<typeof friendMealSchema>;
export const friendMealsSchema = z.object({ meals: z.array(friendMealSchema) });

/** The route's `[id]` is the FRIENDSHIP id; a profile only knows the friend's user id. */
export function friendshipWith(friendships: readonly Friendship[] | undefined, userId: string) {
  return friendships?.find((row) => row.status === 'accepted' && row.otherUser.id === userId);
}

/** One portion's figures, from the whole recipe: whole kcal and grams, as the meal list shows. */
export function portionFigures(meal: SharedMeal) {
  const total = sumMacroTotals(meal.ingredients);
  const per = (value: number) => Math.round(value / meal.servings);
  return {
    calories: per(total.calories),
    proteinG: per(total.proteinG),
    carbsG: per(total.carbsG),
    fatG: per(total.fatG),
  };
}

/** "2 portions · 640 kcal · P 52 C 61 F 17 per portion" (a single portion skips the first part). */
export function friendMealSubtitle(meal: SharedMeal) {
  const f = portionFigures(meal);
  return [
    meal.servings > 1 ? plural(meal.servings, 'portion', 'portions') : null,
    `${f.calories.toLocaleString()} kcal`,
    `P ${f.proteinG} C ${f.carbsG} F ${f.fatG} per portion`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The viewer's own meal names, folded, for the name match below. */
export function ownedNames(mine: readonly { name: string }[]): ReadonlySet<string> {
  return new Set(mine.map((own) => foldedName(own.name)));
}

/** A hint, not a link: the same name (case and spacing aside) means "you probably have this". */
export function haveByName(meal: SharedMeal, owned: ReadonlySet<string>) {
  return owned.has(foldedName(meal.name));
}

/**
 * What "Add all" would add: every meal whose name is not in the viewer's library yet. The check is
 * made once, against the library as it stands, so two meals of the same name in the friend's list
 * are both new.
 */
export function newMeals<T extends { meal: SharedMeal }>(
  meals: readonly T[],
  owned: ReadonlySet<string>,
) {
  return meals.filter((entry) => !haveByName(entry.meal, owned));
}

export function addAllLabel(newCount: number) {
  return newCount > 0
    ? `Add all ${plural(newCount, 'new meal', 'new meals')}`
    : 'You have all of these meals';
}

/** The result line the button turns into once Add all has run. */
export function addAllResult(added: number, skipped: number, unusable: number) {
  return [
    `Added ${plural(added, 'meal', 'meals')}`,
    `skipped ${skipped}`,
    ...(unusable > 0 ? [`${unusable} could not be copied`] : []),
  ].join(' · ');
}
