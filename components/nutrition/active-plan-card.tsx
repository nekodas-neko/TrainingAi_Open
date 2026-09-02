'use client'

import { useEffect, useState } from 'react'
import { nowDatetimeInTz } from '@trainingai/shared/date-utils'
import type { FoodLogWithItem, MealPlan, MealType } from '@trainingai/shared/types/nutrition'
import { usePlanMealLogging } from '@/app/nutrition/use-plan-meal-logging'
import { usePlanMealSaving } from '@/app/nutrition/use-plan-meal-saving'
import { MealPlanSection } from './meal-plan-section'
import { hourFromTzDatetime } from './plan-day-fill'

/**
 * The active meal plan card, with the two hooks that drive it.
 *
 * Extracted from `nutrition-content.tsx` when Q-187's "log the meals so far" action pushed that
 * orchestrator past the 800-line limit. The seam is a real one rather than a size dodge: logging a
 * planned meal, declining one, and copying one into My Foods are the plan's own concerns, and the
 * tab that hosts the card never reads any of their state. What crosses the boundary is the day, the
 * plan, and the one callback that tells the tab a food log was written.
 */
export function ActivePlanCard({
  plan, onPlanChanged, loading, mealTypes, logs, userId, tz, logDate, today, dateRef,
  eaten, onLogged, onCreate, onStepByStep, onViewPlan,
}: {
  plan: MealPlan | null
  onPlanChanged: (plan: MealPlan | null) => void
  loading: boolean
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  userId?: string
  tz: string
  logDate: string
  today: string
  /** Read at call time, not render time — the user can change day mid-request. */
  dateRef: { current: string }
  eaten?: { calories: number; proteinG: number; carbsG: number; fatG: number }
  onLogged: (log: FoodLogWithItem) => void
  onCreate: () => void
  onStepByStep: () => void
  onViewPlan: (planId: string) => void
}) {
  const {
    logMeal, logMeals, bulkLogging, loggingPosition, loggedPositions, declinedMealIds, setDeclined,
  } = usePlanMealLogging({ mealPlan: plan, mealTypes, logs, userId, dateRef, onLogged })

  const { saveMeal, saveMeals, savingPositions } = usePlanMealSaving({
    mealPlan: plan, userId, onPlanChanged,
  })

  // The hour of day in the USER's zone, for the "log the meals so far" offer. Re-read when the day
  // changes rather than on a timer: a 1 Hz clock here would re-render the card every second, and a
  // screen left open across an hour boundary is one nobody is looking at.
  const [nowHour, setNowHour] = useState<number | null>(null)
  useEffect(() => { setNowHour(hourFromTzDatetime(nowDatetimeInTz(tz))) }, [tz, logDate])

  return (
    <MealPlanSection
      plan={plan}
      loading={loading}
      eaten={eaten}
      onLogMeal={mealTypes.length > 0 ? logMeal : undefined}
      loggingPosition={loggingPosition}
      loggedPositions={loggedPositions}
      declinedMealIds={declinedMealIds}
      onSetDeclined={mealTypes.length > 0 ? setDeclined : undefined}
      onLogAll={mealTypes.length > 0 ? logMeals : undefined}
      mealTypes={mealTypes}
      logDate={logDate}
      today={today}
      nowHour={nowHour}
      bulkLogging={bulkLogging}
      onSaveMeal={saveMeal}
      onSaveAllMeals={saveMeals}
      savingPositions={savingPositions}
      onCreate={onCreate}
      onStepByStep={onStepByStep}
      onViewPlan={onViewPlan}
    />
  )
}
