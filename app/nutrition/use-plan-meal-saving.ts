'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { MealPlan, MealPlanMeal } from '@trainingai/shared/types/nutrition'
import { savePlanMealsToLibrary } from '@trainingai/shared/nutrition/save-plan-meal'
import { invalidateMealPlans } from '@/lib/cache-groups'

interface Options {
  mealPlan: MealPlan | null
  userId?: string
  /** Applies the stamped `savedMealId` to the plan held on screen. */
  onPlanChanged: (plan: MealPlan) => void
}

/**
 * Copying planned meals into My Meals (Q-398).
 *
 * The owner builds a plan once and then mostly stops opening it. What should survive it is ordinary
 * saved meals — they log in one tap, print a label with a QR, and can be edited ingredient by
 * ingredient — so the plan itself becomes disposable rather than a thing to keep fresh.
 *
 * **Idempotence uses the column that already exists.** `meal_plan_meals.saved_meal_id` is stamped
 * after each copy and survives a regenerate, so "Save all" pressed twice is a no-op rather than nine
 * duplicates, and it is also what the row reads to show "In My Meals". Deleting the saved meal
 * clears the stamp through the FK's `ON DELETE SET NULL`, so the offer correctly comes back.
 *
 * The stamp is best-effort on purpose: the meal is already in the library by the time it runs, and
 * losing the stamp costs a duplicate offer, not the meal.
 */
export function usePlanMealSaving({ mealPlan, userId, onPlanChanged }: Options) {
  const [savingPositions, setSavingPositions] = useState<Set<number>>(new Set())

  /** Stamp the ids onto the plan in one pass, so a "save all" re-renders once rather than N times. */
  const applyStamps = useCallback((stamped: Map<string, string>) => {
    if (!mealPlan || stamped.size === 0) return
    onPlanChanged({
      ...mealPlan,
      variants: mealPlan.variants.map(v => ({
        ...v,
        meals: v.meals.map(m => stamped.has(m.id) ? { ...m, savedMealId: stamped.get(m.id)! } : m),
      })),
    })
  }, [mealPlan, onPlanChanged])

  const saveMeals = useCallback(async (meals: MealPlanMeal[]) => {
    const todo = meals.filter(m => m.savedMealId == null && m.ingredients.length > 0)
    if (todo.length === 0) return
    setSavingPositions(new Set(todo.map(m => m.position)))

    const { stamped, failed } = await savePlanMealsToLibrary(todo, userId)

    applyStamps(stamped)
    if (stamped.size > 0) await invalidateMealPlans()
    setSavingPositions(new Set())

    if (stamped.size > 0) {
      toast.success(todo.length === 1
        ? `"${todo[0].name}" saved to My Meals`
        : `${stamped.size} meals saved to My Meals`)
    }
    // Reported separately rather than folded into the success line: a partial save is the case
    // where the user needs to know which half happened.
    if (failed > 0) toast.error(failed === 1 ? 'One meal could not be saved' : `${failed} meals could not be saved`)
  }, [userId, applyStamps])

  const saveMeal = useCallback((meal: MealPlanMeal) => saveMeals([meal]), [saveMeals])

  return { saveMeal, saveMeals, savingPositions }
}
