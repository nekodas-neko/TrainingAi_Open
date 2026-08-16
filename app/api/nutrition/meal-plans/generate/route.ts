import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateObject } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { reconcileDailyMacros, carbsFromRemainder } from '@trainingai/shared/nutrition/goal-recommendation'
import {
  splitMacrosAcrossMeals, suggestMealCount, minutesToTime,
  MEAL_COUNT_MIN, MEAL_COUNT_MAX,
} from '@trainingai/shared/nutrition/meal-split'
import type { MealPlanDayType, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import { scaleWithTopUp } from '@/lib/nutrition/meal-top-up'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient'

/**
 * Generate a meal-plan DRAFT. Persists nothing — the client reviews and then POSTs to
 * /api/nutrition/meal-plans.
 *
 * The division of labour matters here. The model picks foods and describes meals; it does NOT
 * decide the numbers. Calorie and macro targets come from the energy-balance service, and the
 * per-meal split comes from `splitMacrosAcrossMeals`. The model's own figures are discarded and
 * replaced with the computed ones, so a plan can never quietly drift from the user's target
 * because the model did arithmetic badly.
 */

const RATE_LIMIT_PER_HOUR = 10

const RequestSchema = z.object({
  mealCount: z.number().int().min(MEAL_COUNT_MIN).max(MEAL_COUNT_MAX).optional(),
  trainingTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  stores: z.array(z.string().max(60)).max(20).optional(),
  excludedFoods: z.array(z.string().max(80)).max(200).optional(),
  /** Ask for a training/rest split rather than one set of macros for every day. */
  splitTrainingRest: z.boolean().optional(),
  /** Saved meals to keep verbatim, in slot order. The model fills whatever slots are left. */
  keepSavedMealIds: z.array(z.string().uuid()).max(6).optional(),
  /** Free-text descriptions of meals the user already eats, to steer the rest of the plan. */
  usualMeals: z.array(z.string().max(200)).max(10).optional(),
  /**
   * Meals the user typed whose macros were looked up client-side, to be kept verbatim alongside
   * `keepSavedMealIds`. Validated here rather than trusted: this is a client body reaching a write
   * path, and the ingredients are what every later portion calculation runs on.
   */
  keepMeals: z.array(z.object({
    name: z.string().min(1).max(200),
    ingredients: NutritionIngredientsSchema,
  })).max(6).optional(),
})

/**
 * What the model returns. Ingredients use the SAME shape as the food scan (`IngredientSchema` in
 * app/api/nutrition/scan): a weight plus per-100g densities. That is reference data, not
 * arithmetic — every total below is summed in code by `sumIngredients`, with its Atwater
 * cross-check, exactly as a scanned photo is. The model still never states a meal total.
 */
const IngredientSchema = z.object({
  name: z.string().describe('Ingredient as you would find it in a supermarket'),
  weightG: z.number().describe('Grams of this ingredient in the meal'),
  caloriesPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
})

const DraftSchema = z.object({
  planName: z.string().describe('Short, plain name for this plan'),
  meals: z.array(z.object({
    name: z.string().describe('Meal name, e.g. "Greek yoghurt with berries and oats"'),
    ingredients: z.array(IngredientSchema),
    notes: z.string().describe('One short line: prep time, swaps, or where to buy it'),
  })),
  restDayAdjustment: z.string().describe('One line on what changes on a rest day, or "" if not applicable'),
})

/** Carbohydrate difference between a training day and a rest day, as a fraction of the daily total. */
const REST_DAY_CARB_REDUCTION = 0.15

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Matches the sibling AI routes — an expensive route gets its limit at creation, not later.
  if (!rateLimit(`${userId}:meal-plan-generate`, RATE_LIMIT_PER_HOUR, 3_600_000)) {
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

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const [balance, targets, restrictions, baseline, savedMeals] = await Promise.all([
    computeEnergyBalance(repo, userId, tz, todayInTz(tz)),
    repo.getNutritionTargets(userId),
    repo.listUserDietaryRestrictions(userId),
    // CURRENT weight, not `users.weight_goal_kg` — the meal-count suggestion is protein per kg of
    // the body doing the eating, and the goal weight would skew it by however far off target
    // the user is.
    repo.getBodyMetricsBaseline(userId),
    // Only fetched when the user asked to keep some — listing the library on every generate would
    // be a wasted query on the common path.
    input.keepSavedMealIds?.length ? repo.listSavedMeals(userId) : Promise.resolve([]),
  ])

  // Meals the user already eats, converted to the same ingredient shape the model produces so the
  // portion scaler treats them identically. Ownership comes from listSavedMeals being user-scoped —
  // an id belonging to someone else simply does not match.
  const kept = [
    ...(input.keepSavedMealIds ?? [])
      .map(id => savedMeals.find(m => m.id === id))
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map(m => ({ id: m.id as string | null, name: m.name, ingredients: savedMealToIngredients(m) })),
    // Typed meals carry no library id — they are not in the library yet, which is exactly why the
    // review step offers to save them.
    ...(input.keepMeals ?? []).map(m => ({ id: null, name: m.name, ingredients: m.ingredients })),
  ].filter(m => m.ingredients.length > 0)

  // The daily target is whatever the user's saved target says, falling back to what the
  // calibration recommends. This route never derives a third number — see D4.
  const dailyCalories = targets?.calories ?? balance.target.recommendedKcal
  if (dailyCalories == null) {
    return NextResponse.json(
      { error: 'Set a calorie target first — add your weight, height, date of birth and sex in Profile.' },
      { status: 400 },
    )
  }
  // Saved macros are not guaranteed to sum to the saved calorie goal — nothing on the targets
  // screen enforces it. Planning against both unreconciled is unsatisfiable by construction, so
  // calories win and carbs take the remainder. `adjusted` is passed to the client to say so.
  const {
    proteinG: dailyProtein, carbsG: dailyCarbs, fatG: dailyFat, adjusted: macrosAdjusted,
  } = reconcileDailyMacros(dailyCalories, {
    proteinG: targets?.proteinG ?? Math.round(dailyCalories * 0.3 / 4),
    fatG: targets?.fatG ?? Math.round(dailyCalories * 0.25 / 9),
    carbsG: targets?.carbsG ?? carbsFromRemainder(
      dailyCalories,
      targets?.proteinG ?? Math.round(dailyCalories * 0.3 / 4),
      targets?.fatG ?? Math.round(dailyCalories * 0.25 / 9),
    ),
  })

  const mealCount = input.mealCount
    ?? suggestMealCount(dailyProtein, baseline.weightKg ?? 0)
    ?? 3

  const allergies = restrictions.filter(r => r.severity === 'allergy').map(r => r.label)
  const avoid = restrictions.filter(r => r.severity === 'avoid').map(r => r.label)

  const dayTypes: MealPlanDayType[] = input.splitTrainingRest ? ['training', 'rest'] : ['all']

  let draft: z.infer<typeof DraftSchema>
  try {
    const result = await loggedGenerateObject(
      { section: 'meal-plan-generate', userId, fingerprint: `${mealCount}:${dayTypes.join('/')}` },
      () => generateObject({
        model: aiModel(),
        schema: DraftSchema,
        maxRetries: 0,
        prompt: [
          'You are a practical sports nutritionist. Design one day of eating.',
          '',
          `Meals: exactly ${mealCount - kept.length}.`,
          // Same phrasing as the per-meal route's `avoidNames`, which measurably works. The earlier
          // wording ("FIXED — do not repeat") did not: a run came back with the kept meal
          // duplicated in the very next slot.
          kept.length
            ? `The plan ALREADY contains these meals, which the user eats and which are not yours to change: ${kept.map(k => k.name).join('; ')}. Everything you return must be genuinely DIFFERENT food from those — different protein, different carb, different style.`
            : '',
          input.usualMeals?.length
            ? `Meals they usually eat, for style — match this kind of food where it fits: ${input.usualMeals.join('; ')}.`
            : '',
          `Daily targets (already decided — do NOT restate or recalculate them): ${dailyCalories} kcal, ${dailyProtein}g protein, ${dailyCarbs}g carbs, ${dailyFat}g fat.`,
          input.trainingTime ? `Trains at about ${input.trainingTime}.` : 'No usual training time.',
          input.stores?.length ? `Shops at: ${input.stores.join(', ')}. Prefer everyday items from these.` : '',
          allergies.length ? `MUST NOT CONTAIN (allergy): ${allergies.join(', ')}. Treat as absolute.` : '',
          avoid.length ? `Avoid (preference): ${avoid.join(', ')}.` : '',
          input.excludedFoods?.length ? `Also exclude: ${input.excludedFoods.join(', ')}.` : '',
          '',
          'Rules:',
          '- For each meal, list its ingredients with a weight in grams and standard per-100g values (calories, protein, carbs, fat). The per-100g figures must be honest reference values for the food — never bend them to make the sums work — and do NOT output a meal total. Totals are summed from your ingredients in code.',
          '- DO choose weights that get close to the targets. Portions are fine-tuned in code afterwards, but only within about half to double what you give, so a meal that starts far off stays off.',
          '- Every meal needs a protein source, a carbohydrate source and a fat source (oil, butter, nuts, seeds, avocado, cheese, or a fattier cut of protein), unless its target for that macro is near zero. A meal missing one can never reach that target however the portions are resized.',
          '- Keep meals realistic and repeatable: everyday supermarket ingredients, minimal prep.',
          '- Order meals through the day, earliest first.',
          input.splitTrainingRest
            ? '- In "restDayAdjustment", say in one line what to change on a rest day (typically slightly fewer carbs).'
            : '- Return "" for "restDayAdjustment".',
        ].filter(Boolean).join('\n'),
      }))
    draft = result.object
  } catch {
    // Every generateText/generateObject call is wrapped and returns a JSON error, never a throw
    // that reaches the client as an opaque 500.
    return NextResponse.json({ error: 'Could not generate a plan right now. Try again shortly.' }, { status: 502 })
  }

  // The model may return the wrong number of meals however firmly it was asked. Pad or trim rather
  // than failing — a plan with one meal missing is recoverable, a 500 is not.
  // Kept meals take the first slots so their position is stable across a reroll of the rest.
  const generatedNeeded = Math.max(0, mealCount - kept.length)
  const generated = draft.meals.slice(0, generatedNeeded)
  while (generated.length < generatedNeeded) {
    generated.push({ name: `Meal ${kept.length + generated.length + 1}`, ingredients: [], notes: '' })
  }
  const names: { name: string; ingredients: NutritionIngredient[]; notes: string; savedMealId?: string | null }[] = [
    ...kept.map(k => ({ name: k.name, ingredients: k.ingredients, notes: '', savedMealId: k.id })),
    ...generated,
  ]

  const variants = await Promise.all(dayTypes.map(async dayType => {
    const carbShift = dayType === 'rest' ? Math.round(dailyCarbs * REST_DAY_CARB_REDUCTION) : 0
    const carbs = dailyCarbs - carbShift
    // Removing carbs removes their calories too; protein and fat are held, per D3.
    const calories = dailyCalories - carbShift * 4
    const slots = splitMacrosAcrossMeals(
      { calories, proteinG: dailyProtein, carbsG: carbs, fatG: dailyFat },
      mealCount,
      { trainingTime: dayType === 'rest' ? null : input.trainingTime ?? null },
    )
    return {
      dayType,
      targetCalories: calories,
      targetProteinG: dailyProtein,
      targetCarbsG: carbs,
      targetFatG: dailyFat,
      meals: await Promise.all(slots.map(async (slot, i) => {
        // The model states reference values and is told not to make them add up, so the portions
        // are decided here. One ingredient list serves both variants — scaling it per variant is
        // what a person actually does (same meal, more rice on a training day) and is also what
        // stops a split plan from showing a permanent shortfall on whichever variant it was not
        // sized for. Whatever gap survives the clamp is still reported, never reconciled away.
        // Scaling alone cannot reach a target the meal has no source for — a saved recipe the user
        // brought is a finished dish, not a balanced slot. scaleWithTopUp asks for food in that
        // case and keeps whichever version fits better, so it can only help.
        const ingredients = await scaleWithTopUp(
          names[i].ingredients as NutritionIngredient[],
          { calories: slot.calories, proteinG: slot.proteinG, carbsG: slot.carbsG, fatG: slot.fatG },
          {
            userId, mealName: names[i].name, allergies, avoid,
            stores: input.stores, excludedFoods: input.excludedFoods,
          },
        )
        // What the listed food ACTUALLY comes to, summed in code. Reported alongside the target
        // rather than reconciled into it: the plan doc's rule is that drift is surfaced, never
        // auto-corrected, and silently rewriting either number would hide a bad suggestion.
        const actual = ingredients.length > 0 ? sumIngredients(ingredients) : null
        return {
          position: i,
          name: names[i].name,
          savedMealId: names[i].savedMealId ?? null,
          notes: names[i].notes || null,
          ingredients,
          actual,
          suggestedTime: minutesToTime(slot.timeMinutes),
          timingRole: slot.timingRole,
          targetCalories: slot.calories,
          targetProteinG: slot.proteinG,
          targetCarbsG: slot.carbsG,
          targetFatG: slot.fatG,
        }
      })),
    }
  }))

  return NextResponse.json({
    planName: draft.planName,
    mealsPerDay: mealCount,
    trainingTime: input.trainingTime ?? null,
    stores: input.stores ?? [],
    excludedFoods: input.excludedFoods ?? [],
    restrictionsSnapshot: restrictions.map(r => ({ code: r.code, label: r.label, severity: r.severity })),
    restDayAdjustment: draft.restDayAdjustment,
    targetCalories: dailyCalories,
    targetProteinG: dailyProtein,
    targetCarbsG: dailyCarbs,
    targetFatG: dailyFat,
    // True when the saved macros did not add up to the saved calorie goal and carbs were refitted.
    macrosAdjusted,
    variants,
    // Surfaced so the review step can render the "must not contain" list beside the ingredients.
    // Capturing restrictions reliably does not make the model's filtering reliable; the user
    // accepting the plan is the check.
    allergies,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
