import { z } from 'zod'

/**
 * One ingredient: a weight plus per-100g reference densities.
 *
 * The one definition of this shape. It was written out four times — the food scan, both meal-plan
 * generators, and now the plan-save path — and it is load-bearing in two different ways at once:
 * it is the schema an LLM is forced to fill, *and* the schema a client body is validated against
 * before it reaches Drizzle. A drift between those copies is either a silently wrong total or an
 * unvalidated write.
 *
 * Bounds are generous but finite; the point is to reject nonsense reaching the database, not to
 * second-guess a real food. Densities are per 100 g, so anything over 1000 is impossible.
 */
export const NutritionIngredientSchema = z.object({
  name: z.string().min(1).max(200).describe('Ingredient as you would find it in a supermarket'),
  weightG: z.number().min(0).max(10000).describe('Grams of this ingredient in the meal'),
  caloriesPer100g: z.number().min(0).max(1000),
  proteinPer100g: z.number().min(0).max(100),
  carbsPer100g: z.number().min(0).max(100),
  fatPer100g: z.number().min(0).max(100),
})

/** A meal's ingredient list. Empty is valid — it means "no breakdown", not "an empty meal". */
export const NutritionIngredientsSchema = z.array(NutritionIngredientSchema).max(40)
