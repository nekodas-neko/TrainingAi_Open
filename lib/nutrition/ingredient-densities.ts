import { getRepository } from '@/lib/data'
import { reportServerError } from '@/lib/observability'
import {
  applyReferenceDensities, type AppliedDensities, type SavedFoodForDensity,
} from '@trainingai/shared/nutrition/food-reference/resolve'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

/**
 * #3749. The model's ingredients with code's per-100 g numbers wherever it knows the food: the
 * signed-in user's own barcode-sourced saved foods first, then the bundled USDA table, else the
 * model's own figures marked `estimated`. The order and the matching rule are
 * `resolveIngredientDensity`'s; this only reads the user's saved foods for it.
 *
 * The read is scoped to `userId` by the repository, so another user's food can never resolve here.
 * When it fails the ingredients still resolve against the table, and the failure is reported: the
 * scan or plan the person asked for is worth more than the saved-food half of the lookup.
 */
export async function resolveModelIngredients(
  userId: string,
  ingredients: readonly NutritionIngredient[],
): Promise<AppliedDensities> {
  let savedFoods: SavedFoodForDensity[] = []
  if (ingredients.length > 0) {
    try {
      const repo = await getRepository()
      savedFoods = await repo.listFoodItemsByNames(userId, ingredients.map(i => i.name))
    } catch (err) {
      reportServerError(err, { userId, url: 'ingredient-densities' })
    }
  }
  return applyReferenceDensities(ingredients, { savedFoods })
}
