'use client'

import { useMemo } from 'react'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import type { MealPlan } from '@trainingai/shared/types/nutrition'

/**
 * Which saved meals came from the meal plan (Q-398).
 *
 * **Derived, never stored.** A saved meal is plan-derived exactly when some plan meal points at it,
 * and `meal_plan_meals.saved_meal_id` already records that — so a `from_plan` column would be a
 * second copy of a fact the schema holds, and would go stale the moment a plan was deleted.
 *
 * `useCachedValue`, not a seed-once effect: the ids only become correct after a copy stamps them,
 * and `invalidateMealPlans()` is what announces that. A `useEffect(…, [])` reading the cache once
 * showed no tag at all on the first open after saving — the Q-402 shape, in miniature. The key and
 * TTL are the Nutrition tab's own, so this shares that fetch rather than adding one.
 */
export function usePlanSavedMealIds(): Set<string> {
  const data = useCachedValue<{ plans: MealPlan[] }>('meal-plans', '/api/nutrition/meal-plans', TTL_MEDIUM)

  return useMemo(() => {
    const plan = data?.plans.find(p => p.isActive)
    if (!plan) return new Set<string>()
    return new Set(
      plan.variants.flatMap(v => v.meals.map(m => m.savedMealId).filter((id): id is string => id != null)),
    )
  }, [data])
}
