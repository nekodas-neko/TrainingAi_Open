import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient'
import { scaleWithTopUp } from '@/lib/nutrition/meal-top-up'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One meal with its ingredient snapshot.
const MAX_BODY_BYTES = 256 * 1024

// Whitelisted, same reasoning as the plan PATCH. The repository proves ownership by joining this
// meal's variant back to its plan before writing — the meal id alone says nothing about who owns it.
const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  targetCalories: z.number().int().min(0).max(10000).optional(),
  targetProteinG: z.number().min(0).max(1000).optional(),
  targetCarbsG: z.number().min(0).max(1000).optional(),
  targetFatG: z.number().min(0).max(1000).optional(),
  mealTypeId: z.string().uuid().nullable().optional(),
  savedMealId: z.string().uuid().nullable().optional(),
  ingredients: NutritionIngredientsSchema.optional(),
  suggestedTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  /**
   * Portion the supplied ingredients to this meal's stored targets before saving, topping the meal
   * up with extra food when scaling alone cannot reach them.
   *
   * Opt-in because a rename PATCHes this route too, and a rename must not silently reprice a meal
   * or spend an AI call. Off, `ingredients` are stored exactly as sent — which is what a caller
   * that has already scaled them wants.
   */
  scaleToTarget: z.boolean().optional(),
}).strict()

export async function PATCH(req: Request, { params }: { params: Promise<{ mealId: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { mealId } = await params
  const badId = invalidUuidResponse(mealId)
  if (badId) return badId

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const repo = await getRepository()
  const { scaleToTarget, ...input } = parsed.data

  if (scaleToTarget && input.ingredients) {
    // Scale against the meal's OWN stored targets, read here rather than taken from the request —
    // a client that sent the wrong targets would otherwise silently reprice the meal.
    const current = await repo.getMealPlanMeal(mealId, userId)
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const restrictions = await repo.listUserDietaryRestrictions(userId)
    input.ingredients = await scaleWithTopUp(
      input.ingredients as NutritionIngredient[],
      {
        calories: current.targetCalories,
        proteinG: current.targetProteinG,
        carbsG: current.targetCarbsG,
        fatG: current.targetFatG,
      },
      {
        userId,
        mealName: input.name ?? current.name,
        allergies: restrictions.filter(r => r.severity === 'allergy').map(r => r.label),
        avoid: restrictions.filter(r => r.severity === 'avoid').map(r => r.label),
      },
    )
  }

  const meal = await repo.updateMealPlanMeal(mealId, userId, input)
  if (!meal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(meal)
}
