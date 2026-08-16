import { z } from 'zod'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { scaleIngredientsToTargets } from '@trainingai/shared/nutrition/meal-split'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import {
  mealFit, fitDistance, TOP_UP_MIN_IMPROVEMENT, type MacroTotals,
} from '@trainingai/shared/nutrition/meal-macro-fit'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

/**
 * Adding food to a meal that cannot reach its target by being resized.
 *
 * The portion scaler only ever *resizes what is already there*. That is right for a meal the model
 * designed for the slot, and wrong for a meal the user brought: a saved recipe is a finished dish,
 * not a balanced slot.
 *
 * **The mechanism is worse than a clamp limit, and it was measured rather than assumed.** Take the
 * owner's own meal — a protein ice cream of milk and whey — into a carb-heavy slot. Full cream milk
 * is 31 kcal of fat against 18 of carbohydrate per 100 g, and its protein share is 22%, under
 * `PROTEIN_SHARE_THRESHOLD` — so the scaler files it under **fat**. Whey is protein. Nothing in the
 * meal is a carb source, the carb group is *empty*, and no scale factor of any size moves
 * carbohydrate at all. Doubling the carb target changes the result by nothing.
 *
 * So **widening the clamp would not have helped even slightly** — a tempting fix aimed at the wrong
 * mechanism. (It is also what stops a plan prescribing 400 g of feta, so it stays.) The gap is a
 * missing *food*, and the only answer is to add one.
 *
 * **The model, not a lookup table.** A built-in filler list ("rice for carbs, oil for fat") cannot
 * see the user's allergies, their shops, or what the meal actually is; adding rice to an ice cream
 * is worse than the gap. The generator already holds that context and already returns this exact
 * shape.
 *
 * Bounded so it can only help:
 *  - runs at most once per meal, and only when a macro is genuinely SHORT (never when overshooting —
 *    that is the scaler's job and adding food would make it worse);
 *  - asks for at most 3 additions;
 *  - re-scales the combined list through the same scaler, so the additions are portioned, not
 *    bolted on at whatever weight the model guessed;
 *  - and **keeps the addition only if it improves the fit meaningfully** (`TOP_UP_MIN_IMPROVEMENT`),
 *    so a bad suggestion can never leave the meal worse — nor clutter it for a rounding error. If
 *    the call fails, the meal keeps its honest gap.
 */

const MAX_TOP_UP_INGREDIENTS = 3

const TopUpSchema = z.object({
  ingredients: z.array(z.object({
    name: z.string().describe('Ingredient as you would find it in a supermarket'),
    weightG: z.number(),
    caloriesPer100g: z.number(),
    proteinPer100g: z.number(),
    carbsPer100g: z.number(),
    fatPer100g: z.number(),
  })).max(MAX_TOP_UP_INGREDIENTS),
})

export interface TopUpContext {
  userId: string
  mealName: string
  allergies: string[]
  avoid: string[]
  stores?: string[]
  excludedFoods?: string[]
}

type Targets = { proteinG: number; carbsG: number; fatG: number }

/** Which macros the meal is short of, worst first, as prompt-ready text. */
function shortfalls(actual: MacroTotals, target: MacroTotals & { calories: number }): string[] {
  const fit = mealFit(actual, target)
  return ([
    ['protein', fit.protein],
    ['carbohydrate', fit.carbs],
    ['fat', fit.fat],
  ] as const)
    .filter(([, f]) => f.status === 'under')
    .sort((a, b) => a[1].ratio - b[1].ratio)
    .map(([label, f]) => `${Math.round(-f.delta)}g more ${label}`)
}

/**
 * Scale a meal to its targets, adding food first if scaling alone cannot get there.
 *
 * Always returns a usable ingredient list — the plainly-scaled one when no top-up is needed, is
 * possible, or turns out to be an improvement.
 */
export async function scaleWithTopUp(
  ingredients: NutritionIngredient[],
  targets: Targets & { calories: number },
  ctx: TopUpContext,
): Promise<NutritionIngredient[]> {
  const scaled = scaleIngredientsToTargets(ingredients, targets) as NutritionIngredient[]
  if (scaled.length === 0) return scaled

  const actual = sumIngredients(scaled)
  const missing = shortfalls(actual, targets)
  if (missing.length === 0) return scaled

  let extra: NutritionIngredient[]
  try {
    const result = await loggedGenerateObject(
      { section: 'meal-plan-top-up', userId: ctx.userId, fingerprint: String(Math.round(targets.calories)) },
      () => generateObject({
        model: aiModel(),
        schema: TopUpSchema,
        maxRetries: 0,
        prompt: [
          'You are a practical sports nutritionist. A meal is short of its targets and cannot get there by serving more of what it already contains.',
          '',
          `The meal: ${ctx.mealName}`,
          `It currently contains: ${scaled.map(i => `${i.name} ${Math.round(i.weightG)}g`).join(', ')}`,
          `It needs roughly: ${missing.join(', ')}.`,
          '',
          ctx.stores?.length ? `Shops at: ${ctx.stores.join(', ')}.` : '',
          ctx.allergies.length ? `MUST NOT CONTAIN (allergy): ${ctx.allergies.join(', ')}. Treat as absolute.` : '',
          ctx.avoid.length ? `Avoid (preference): ${ctx.avoid.join(', ')}.` : '',
          ctx.excludedFoods?.length ? `Also exclude: ${ctx.excludedFoods.join(', ')}.` : '',
          '',
          'Rules:',
          `- Suggest at most ${MAX_TOP_UP_INGREDIENTS} ADDITIONAL ingredients. Do not repeat or restate anything already in the meal.`,
          '- They must genuinely belong with this meal. Something that would be strange to eat alongside it is worse than leaving the meal short.',
          '- Give a weight in grams and honest per-100g reference values. Never bend the reference values to hit a number — the portions are fine-tuned in code afterwards.',
          '- Prefer one or two everyday items over three obscure ones.',
        ].filter(Boolean).join('\n'),
      }))
    extra = result.object.ingredients as NutritionIngredient[]
  } catch {
    // The gap stands and is displayed, exactly as before this existed.
    return scaled
  }

  if (extra.length === 0) return scaled

  const merged = scaleIngredientsToTargets([...ingredients, ...extra], targets) as NutritionIngredient[]
  // The decisive guard: a top-up has to improve the fit MEANINGFULLY or it is discarded. Not "at
  // all" — measured, 40 g of celery in a protein ice cream improves the fit by 0.4%, and a bare
  // better-or-not comparison would happily keep it. Fewer ingredients is a better meal.
  const before = fitDistance(actual, targets)
  const after = fitDistance(sumIngredients(merged), targets)
  return after < before * (1 - TOP_UP_MIN_IMPROVEMENT) ? merged : scaled
}
