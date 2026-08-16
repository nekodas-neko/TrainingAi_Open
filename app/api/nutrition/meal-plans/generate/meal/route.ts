import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { rateLimit } from '@/lib/rate-limit'
import { scaleWithTopUp } from '@/lib/nutrition/meal-top-up'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

/**
 * Regenerate ONE meal against a target the caller already holds.
 *
 * The whole-plan route rerolls every meal, so disliking one suggestion cost the other two as well.
 * This route changes nothing else: the targets come in from the split the plan was built with and
 * are echoed back untouched, so a swap can never move the day's totals.
 *
 * Same division of labour as its sibling — the model picks food and states per-100g reference
 * values; every total is summed in code by `sumIngredients`.
 */

// Higher than the whole-plan limit: one meal is a fraction of the cost, and rerolling two or three
// meals in a row is the normal way this gets used rather than abuse.
const RATE_LIMIT_PER_HOUR = 40

const IngredientInputSchema = z.object({
  name: z.string().max(200),
  weightG: z.number().min(0).max(5000),
  caloriesPer100g: z.number().min(0).max(1000),
  proteinPer100g: z.number().min(0).max(100),
  carbsPer100g: z.number().min(0).max(100),
  fatPer100g: z.number().min(0).max(100),
})

const RequestSchema = z.object({
  targetCalories: z.number().min(0).max(10000),
  targetProteinG: z.number().min(0).max(1000),
  targetCarbsG: z.number().min(0).max(1000),
  targetFatG: z.number().min(0).max(1000),
  timingRole: z.enum(['pre_workout', 'post_workout']).nullable().optional(),
  suggestedTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  stores: z.array(z.string().max(60)).max(20).optional(),
  excludedFoods: z.array(z.string().max(80)).max(200).optional(),
  /** Meals already in the plan — including the one being replaced — so the reroll differs. */
  avoidNames: z.array(z.string().max(200)).max(12).optional(),
  /**
   * A plain-language change to make to `currentMeal` — "make this vegetarian", "swap the quinoa
   * for rice". With it this route rewrites rather than regenerates, which is a different job: the
   * point is to keep everything the instruction does not touch.
   */
  instruction: z.string().trim().min(1).max(200).optional(),
  currentMeal: z.object({
    name: z.string().max(200),
    ingredients: z.array(IngredientInputSchema).max(30),
  }).optional(),
})

const IngredientSchema = z.object({
  name: z.string().describe('Ingredient as you would find it in a supermarket'),
  weightG: z.number().describe('Grams of this ingredient in the meal'),
  caloriesPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
})

const MealSchema = z.object({
  name: z.string().describe('Meal name, e.g. "Greek yoghurt with berries and oats"'),
  ingredients: z.array(IngredientSchema),
  notes: z.string().describe('One short line: prep time, swaps, or where to buy it'),
})

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:meal-plan-generate-meal`, RATE_LIMIT_PER_HOUR, 3_600_000)) {
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = RequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const input = parsed.data

  // Restrictions are read from the database, never taken from the request. A client that omitted
  // them would silently get a plan built without an allergy the user has recorded.
  const repo = await getRepository()
  const restrictions = await repo.listUserDietaryRestrictions(userId)
  const allergies = restrictions.filter(r => r.severity === 'allergy').map(r => r.label)
  const avoid = restrictions.filter(r => r.severity === 'avoid').map(r => r.label)

  // A rewrite needs both halves: an instruction with nothing to apply it to is a fresh generation
  // wearing the wrong prompt.
  const rewriting = !!input.instruction && !!input.currentMeal

  const timingLine = input.timingRole === 'pre_workout'
    ? 'This meal is eaten shortly BEFORE training — keep fat low so it sits light.'
    : input.timingRole === 'post_workout'
      ? 'This meal is eaten shortly AFTER training.'
      : ''

  let meal: z.infer<typeof MealSchema>
  try {
    const result = await loggedGenerateObject(
      { section: rewriting ? 'meal-plan-edit-meal' : 'meal-plan-generate-meal', userId, fingerprint: String(Math.round(input.targetCalories)) },
      () => generateObject({
        model: aiModel(),
        schema: MealSchema,
        maxRetries: 0,
        prompt: [
          rewriting
            ? 'You are a practical sports nutritionist. REWRITE the meal below, following the change the user asked for and keeping everything else about it as close as you can.'
            : 'You are a practical sports nutritionist. Design ONE meal.',
          '',
          rewriting ? '' : '',
          rewriting ? `Current meal: ${input.currentMeal!.name}` : '',
          rewriting
            ? `Its ingredients: ${input.currentMeal!.ingredients.map(i => `${i.name} ${Math.round(i.weightG)}g`).join(', ')}`
            : '',
          rewriting ? `The change to make: ${input.instruction}` : '',
          rewriting ? 'Keep the rest of the meal recognisably the same — this is an edit, not a new suggestion.' : '',
          `It should land near ${Math.round(input.targetCalories)} kcal, ${Math.round(input.targetProteinG)}g protein, ${Math.round(input.targetCarbsG)}g carbs, ${Math.round(input.targetFatG)}g fat.`,
          input.suggestedTime ? `Eaten at about ${input.suggestedTime}.` : '',
          timingLine,
          input.stores?.length ? `Shops at: ${input.stores.join(', ')}. Prefer everyday items from these.` : '',
          allergies.length ? `MUST NOT CONTAIN (allergy): ${allergies.join(', ')}. Treat as absolute.` : '',
          avoid.length ? `Avoid (preference): ${avoid.join(', ')}.` : '',
          input.excludedFoods?.length ? `Also exclude: ${input.excludedFoods.join(', ')}.` : '',
          // Deliberately suppressed when rewriting: "be different from the plan" fights an
          // instruction whose whole point is to keep this meal and change one thing about it.
          !rewriting && input.avoidNames?.length
            ? `Suggest something genuinely DIFFERENT from these, which are already in the plan: ${input.avoidNames.join('; ')}.`
            : '',
          '',
          'Rules:',
          '- List the ingredients with a weight in grams and standard per-100g values (calories, protein, carbs, fat). The per-100g figures must be honest reference values for the food — never bend them to hit the numbers above — and do NOT output a meal total. Totals are summed from your ingredients in code.',
          '- DO choose weights that get close to the targets. Portions are fine-tuned in code afterwards, but only within about half to double what you give, so a meal that starts far off stays off.',
          '- Include a protein source, a carbohydrate source and a fat source (oil, butter, nuts, seeds, avocado, cheese, or a fattier cut of protein), unless the target for that macro is near zero. A meal missing one can never reach that target however the portions are resized.',
          '- Keep it realistic and repeatable: everyday supermarket ingredients, minimal prep.',
        ].filter(Boolean).join('\n'),
      }))
    meal = result.object
  } catch {
    return NextResponse.json({
      error: rewriting
        ? 'Could not apply that change right now. Try again shortly.'
        : 'Could not rewrite that meal right now. Try again shortly.',
    }, { status: 502 })
  }

  // Same portion scaling the whole-plan route applies, so a reroll lands on the target instead of
  // arriving with the drift its predecessor had — plus a top-up when scaling alone cannot reach it,
  // which is the common case for a rewrite that swapped a dense ingredient for a lighter one.
  const ingredients = await scaleWithTopUp(
    meal.ingredients as NutritionIngredient[],
    {
      calories: input.targetCalories,
      proteinG: input.targetProteinG, carbsG: input.targetCarbsG, fatG: input.targetFatG,
    },
    { userId, mealName: meal.name, allergies, avoid, stores: input.stores, excludedFoods: input.excludedFoods },
  )

  return NextResponse.json({
    name: meal.name,
    notes: meal.notes || null,
    ingredients,
    actual: ingredients.length > 0 ? sumIngredients(ingredients) : null,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
