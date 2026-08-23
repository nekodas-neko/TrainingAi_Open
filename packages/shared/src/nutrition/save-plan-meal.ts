import type { MealPlanMeal, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { ingredientToEntry } from '@trainingai/shared/nutrition/log-plan-meal'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { todayInTz } from '../date-utils'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateSavedMeals } from '@/lib/cache-groups'

/**
 * Copying a planned meal into the saved-meal library (Q-398).
 *
 * The owner's framing is that a plan is a **batch generator**, not somewhere to live: it gets built
 * once and then mostly not opened again. What survives it should be ordinary saved meals, which
 * already log in one tap, print a label with a QR, and can be edited ingredient by ingredient.
 *
 * **The copy goes through the same per-100g conversion as logging a planned meal**
 * (`ingredientToEntry`), so a meal saved from the plan and the same meal logged from the plan mint
 * food items with identical numbers. Two conversions would have drifted the first time either was
 * rounded differently.
 *
 * **Copy, never share.** A plan meal and a saved meal stay separate records: a plan is a schedule of
 * suggestions and a saved meal is a recipe you own, so editing one must not silently rewrite the
 * other, and deleting a plan must not take the meals with it.
 *
 * Idempotence lives with the caller, not here — `meal_plan_meals.saved_meal_id` already exists and
 * already survives a regenerate, so a meal that carries one is skipped rather than re-copied.
 */
export interface PlanMealToSave {
  name: string
  ingredients: NutritionIngredient[]
}

/** The new saved meal's id. Throws if the meal has nothing to copy or the write fails outright. */
export async function savePlanMealToLibrary(meal: PlanMealToSave, userId?: string): Promise<string> {
  if (meal.ingredients.length === 0) throw new Error('This meal has no ingredients to save')

  const entries = meal.ingredients.map(ingredientToEntry)
  // Serial, not `Promise.all`: each one writes to the same local table and queues its own outbox
  // row, and a nine-ingredient meal is not worth racing them for.
  const items: { foodItemId: string; quantityMultiplier: number }[] = []
  for (const entry of entries) {
    const item = await createFoodItem(entry, userId)
    // The schema floor is 0.01, and a sub-gram garnish rounds to 0.00 two decimals in.
    items.push({ foodItemId: item.id, quantityMultiplier: Math.max(0.01, entry.quantityMultiplier) })
  }

  const mealId = crypto.randomUUID()
  // A plan meal is one portion by definition — it is what the plan expects to be eaten at that
  // slot, not a batch. `servings: 1` says so explicitly rather than leaning on the column default.
  const body = { id: mealId, name: meal.name, items, servings: 1 }

  let savedLocally = false
  const store = userId ? getLocalStore(userId) : null
  if (store && userId) {
    try {
      const now = new Date().toISOString()
      await store.upsertSavedMeal(
        { id: mealId, name: meal.name, servings: 1, createdAt: now, updatedAt: now, deletedAt: null, syncStatus: 'pending' },
        items.map(it => ({ id: crypto.randomUUID(), savedMealId: mealId, ...it })),
      )
      // todayInTz(), never an ISO string's date part — that is UTC, and it is yesterday in
      // Brisbane until 10am every day.
      await store.queueMutation({ userId, domain: 'saved_meals', date: todayInTz(), payload: body })
      await invalidateSavedMeals()
      pushThenRevalidate(userId, invalidateSavedMeals)
      savedLocally = true
    } catch (e) {
      // Its own catch, outside the API call below: a local write that throws must fall through to
      // the server rather than into an error toast (Q-216).
      console.error('Plan-meal saved-meal SQLite write failed, falling back to API:', e)
    }
  }

  if (!savedLocally) {
    // Web fallback (no local store, or the local write threw). A pure pass-through.
    const res = await fetch('/api/nutrition/saved-meals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Could not save that meal')
    await invalidateSavedMeals()
  }

  return mealId
}

export interface PlanMealSaveResult {
  /** Plan-meal id → the saved meal it became, for the caller to stamp onto the plan on screen. */
  stamped: Map<string, string>
  failed: number
}

/**
 * Copy a batch of planned meals, skipping the ones already kept, and stamp each result back onto
 * its plan meal.
 *
 * Both surfaces that copy plan meals go through here — the plan card's Save / Save all, and the
 * setup sheet's "meals you already eat" ticks. They were separate implementations, and only one of
 * them created the food items offline-first or recorded that the meal had been kept, so ticking a
 * meal at setup and then saving it from the card produced a duplicate.
 *
 * Serial rather than `Promise.all`: each meal writes several rows to the same local tables and
 * queues its own outbox mutations, and nine of them is not worth racing.
 */
export async function savePlanMealsToLibrary(
  meals: MealPlanMeal[],
  userId?: string,
): Promise<PlanMealSaveResult> {
  const stamped = new Map<string, string>()
  let failed = 0
  for (const meal of meals) {
    if (meal.savedMealId != null || meal.ingredients.length === 0) continue
    try {
      const savedMealId = await savePlanMealToLibrary({ name: meal.name, ingredients: meal.ingredients }, userId)
      stamped.set(meal.id, savedMealId)
      // Best-effort: the meal is already in the library by the time this runs, so losing the stamp
      // costs a duplicate offer, never the meal.
      await fetch(`/api/nutrition/meal-plans/meals/${meal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savedMealId }),
      }).catch(() => {})
    } catch {
      failed += 1
    }
  }
  return { stamped, failed }
}
