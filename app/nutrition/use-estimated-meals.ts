'use client'

import { useEffect, useState } from 'react'
import type { FoodLogWithItem, MealPlan, MealType } from '@trainingai/shared/types/nutrition'
import { countedEstimates } from '@trainingai/shared/nutrition/meal-estimate'
import { getLocalStore } from '@/lib/local-store'

/** Fired after a plan-meal answer is written on this device, so the ring re-reads the estimate. */
export const PLAN_MEAL_ANSWERS_CHANGED = 'plan-meal-answers-changed'

export function notifyPlanMealAnswersChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_MEAL_ANSWERS_CHANGED))
}

export interface EstimatedMeals {
  /** Calories the day's totals include for planned meals nobody logged. 0 on an ordinary day. */
  kcal: number
  /** Their meal types, lower-case and joined ("lunch, snack"), or null when not known here. */
  meals: string | null
}

/**
 * #2072. The estimate the Nutrition ring adds to the day's logged food, read LOCAL-FIRST: the
 * device's `plan_meal_answers` through the same `countedEstimates` rule the server's energy balance
 * uses (#2122), so the centre number and the payload's `intakeKcal` agree once the answers sync.
 *
 * With no local store (the web dev build) the server's figure stands in and the meal names are
 * unknown. With no active plan there is nothing to estimate, which is every day for a user without
 * one — and why production holds no estimate rows yet.
 */
export function useEstimatedMeals({ userId, date, mealPlan, mealTypes, logs, serverEstimatedKcal }: {
  userId?: string
  date: string
  mealPlan: MealPlan | null
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  /** `balance.estimatedKcal` for this date, used only where there is no local store. */
  serverEstimatedKcal: number | null | undefined
}): EstimatedMeals {
  const [local, setLocal] = useState<EstimatedMeals | null>(null)
  const store = userId ? getLocalStore(userId) : null

  useEffect(() => {
    if (!store) { setLocal(null); return }
    if (!mealPlan) { setLocal({ kcal: 0, meals: null }); return }
    let cancelled = false
    const read = () => {
      store.getPlanMealAnswers(date).then(answers => {
        if (cancelled) return
        const rows = countedEstimates({
          answers: answers.filter(a => a.deletedAt == null),
          planMeals: mealPlan.variants.flatMap(v => v.meals),
          mealTypes,
          loggedMealTypeIds: new Set(logs.map(l => l.mealTypeId)),
        })
        const kcal = Math.round(rows.reduce((s, r) => s + r.kcal, 0))
        const names = [...new Set(rows.map(r => mealTypes.find(t => t.id === r.mealTypeId)?.name?.toLowerCase()).filter(Boolean))]
        setLocal({ kcal, meals: names.length > 0 ? names.join(', ') : null })
      }).catch(() => { if (!cancelled) setLocal({ kcal: 0, meals: null }) })
    }
    read()
    window.addEventListener(PLAN_MEAL_ANSWERS_CHANGED, read)
    return () => { cancelled = true; window.removeEventListener(PLAN_MEAL_ANSWERS_CHANGED, read) }
  }, [store, date, mealPlan, mealTypes, logs])

  if (store) return local ?? { kcal: 0, meals: null }
  return { kcal: Math.max(0, Math.round(serverEstimatedKcal ?? 0)), meals: null }
}
