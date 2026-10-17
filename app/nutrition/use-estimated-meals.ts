'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FoodLogWithItem, MealType } from '@trainingai/shared/types/nutrition'
import { countedEstimates } from '@trainingai/shared/nutrition/meal-estimate'
import { readEstimateRows, countedEstimateTotal, type CountedEstimateRow } from '@trainingai/shared/nutrition/counted-intake'
import { getLocalStore } from '@/lib/local-store'

/** Fired after a plan-meal answer is written on this device, so the ring re-reads the estimate. */
export const PLAN_MEAL_ANSWERS_CHANGED = 'plan-meal-answers-changed'

export function notifyPlanMealAnswersChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_MEAL_ANSWERS_CHANGED))
}

/**
 * #2863. The day's counted estimates as rows (`{ mealTypeId, kcal }`), read LOCAL-FIRST from the same
 * `plan_meal_answers` the ring reads, for the surfaces that add them to logged food through
 * `countedIntakeKcal` (the logger's "Today after logging", the day screen's "Eaten"). Offline, or
 * before an answer has synced, the ring and these now start from the same rows.
 *
 * The rows are NOT filtered by the day's logs: the caller passes its own log meal types to
 * `countedIntakeKcal`, which drops a superseded estimate (and the logger adds the meal type of the
 * food it is about to log). With no local store the server's `balance.estimatedMeals` stand in.
 */
export function useCountedEstimateRows({ userId, date, serverRows }: {
  userId?: string
  date: string
  serverRows: unknown
}): CountedEstimateRow[] {
  const [local, setLocal] = useState<CountedEstimateRow[] | null>(null)
  const store = userId ? getLocalStore(userId) : null

  useEffect(() => {
    if (!store) { setLocal(null); return }
    let cancelled = false
    const read = () => {
      Promise.all([store.getPlanMealAnswers(date), store.getActiveMealPlan(), store.getMealTypes()]).then(([answers, plan, types]) => {
        if (cancelled) return
        if (!plan) { setLocal([]); return }
        const rows = countedEstimates({
          answers: answers.filter(a => a.deletedAt == null),
          planMeals: plan.variants.flatMap(v => v.meals),
          mealTypes: types.map(t => ({ ...t, userId: userId!, createdAt: new Date(0) })) as MealType[],
          loggedMealTypeIds: new Set(),
        })
        setLocal(rows.map(r => ({ mealTypeId: r.mealTypeId, kcal: r.kcal })))
      }).catch(() => { if (!cancelled) setLocal([]) })
    }
    read()
    window.addEventListener(PLAN_MEAL_ANSWERS_CHANGED, read)
    return () => { cancelled = true; window.removeEventListener(PLAN_MEAL_ANSWERS_CHANGED, read) }
  }, [store, date, userId])

  const serverEstimates = useMemo(() => readEstimateRows(serverRows), [serverRows])
  // Until the first local read lands, the server's rows hold the place rather than flashing 0.
  return store ? local ?? serverEstimates : serverEstimates
}

export interface EstimatedMeals {
  /** Calories the day's totals include for planned meals nobody logged. 0 on an ordinary day. */
  kcal: number
  /** Their meal types, lower-case and joined ("lunch, snack"), or null when none count. */
  meals: string | null
}

/**
 * The ring's figure and meal names from the day's estimate rows. The kcal is `countedEstimateTotal`,
 * the same arithmetic `planCardEatenKcal` and the logger apply, so one set of rows gives one number.
 */
export function estimatedMealsFromRows(
  rows: readonly CountedEstimateRow[],
  mealTypes: readonly MealType[],
  loggedMealTypeIds: Iterable<string | null | undefined>,
): EstimatedMeals {
  const logged = new Set(loggedMealTypeIds)
  const counted = rows.filter(r => !logged.has(r.mealTypeId))
  const names = [...new Set(counted.map(r => mealTypes.find(t => t.id === r.mealTypeId)?.name?.toLowerCase()).filter(Boolean))]
  return { kcal: countedEstimateTotal(rows, logged), meals: names.length > 0 ? names.join(', ') : null }
}

/**
 * #2072, #2960. The estimate the Nutrition ring adds to the day's logged food. A thin layer over
 * `useCountedEstimateRows`, so the ring and every other calorie total (Active Plan card, end-of-day
 * card, the logger, the day screen) start from one set of rows and one placeholder.
 *
 * Before the first local read the server's `balance.estimatedMeals` stand in, not 0: a repeat visit
 * never flashes a different number (docs/rules/mobile-and-runtime.md), and those rows are what the
 * other surfaces already show. The plan comes from the local store, not the screen's `mealPlan` prop,
 * which had a second source and could trail a plan switch; the screen re-fires
 * `notifyPlanMealAnswersChanged` when its plan changes so the read follows. The meal names still come
 * from the screen's `mealTypes`. Also returns the rows, so the screen reads the store once.
 */
export function useEstimatedMeals({ userId, date, mealTypes, logs, serverRows }: {
  userId?: string
  date: string
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  /** `balance.estimatedMeals` for this date: the placeholder, and the answer with no local store. */
  serverRows: unknown
}): EstimatedMeals & { rows: CountedEstimateRow[] } {
  const rows = useCountedEstimateRows({ userId, date, serverRows })
  const estimate = useMemo(
    () => estimatedMealsFromRows(rows, mealTypes, logs.map(l => l.mealTypeId)),
    [rows, mealTypes, logs],
  )
  return { ...estimate, rows }
}
