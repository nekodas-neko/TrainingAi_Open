import { z } from 'zod'

/**
 * #3749. The one ingredient shape the model is asked to fill, in all four AI food routes: the food
 * scan (`app/api/nutrition/scan`), both meal-plan generators (`meal-plans/generate` and
 * `generate/meal`) and the top-up (`lib/nutrition/meal-top-up.ts`). It was written out four times.
 *
 * The model still states per-100 g values, because no route knows before the reply which names the
 * resolver will recognise, and an unmatched ingredient keeps the model's figures exactly as it did
 * before. Where code knows the food, `applyReferenceDensities` replaces them.
 *
 * Deliberately unbounded, unlike `NutritionIngredientSchema` (the request validator): a bound here
 * makes the SDK reject the whole reply over one odd number, which `sanitiseNutrition` and the
 * resolver exist to repair. Structured output only; never `JSON.parse` of model text.
 */
export const ModelIngredientSchema = z.object({
  name: z.string().describe('Ingredient as you would find it in a supermarket'),
  weightG: z.number().describe('Grams of this ingredient in the meal'),
  caloriesPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
})

export type ModelIngredient = z.infer<typeof ModelIngredientSchema>
