'use client'

import { useEffect, useState } from 'react'
import { nowDatetimeInTz } from '@trainingai/shared/date-utils'
import type { FoodLogWithItem, MealPlan, MealType } from '@trainingai/shared/types/nutrition'
import type { NextSessionRecommendation } from '@trainingai/shared/types/program'
import { NEXT_SESSION_TTL } from '@trainingai/shared/cache-ttl'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { isSplitPlan, trainingDayForPlanDate } from './plan-variant-day'
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
  const { saveMeal, saveMeals, savingPositions } = usePlanMealSaving({
    mealPlan: plan, userId, onPlanChanged,
  })

  // The hour of day in the USER's zone, for the "log the meals so far" offer. Re-read when the day
  // changes rather than on a timer: a 1 Hz clock here would re-render the card every second, and a
  // screen left open across an hour boundary is one nobody is looking at.
  const [nowHour, setNowHour] = useState<number | null>(null)
  useEffect(() => { setNowHour(hourFromTzDatetime(nowDatetimeInTz(tz))) }, [tz, logDate])

  /**
   * LA-184. `MealPlanSection` has taken `isTrainingDay?: boolean` since it was written and nothing
   * ever passed it, so a split plan showed its REST variant every day.
   *
   * `useCachedValue` rather than a seed-only read or a `useEffect(…, [])`: this card lives in the
   * **persistent tab shell**, which never unmounts, so a fetch-once effect would hold its first
   * answer until the app was killed — the Q-402 shape. `today: true` because `next-session` is a
   * `cachedFetchToday` key at every other site and the variant is a property of the KEY, and
   * `NEXT_SESSION_TTL` because that key has one canonical TTL.
   *
   * `onError` is a deliberate no-op: an unknown day type falls back to the behaviour above it, and
   * a meal plan is not the surface to report a workout recommendation's failure on.
   */
  const rec = useCachedValue<NextSessionRecommendation>(
    'next-session', '/api/next-session', NEXT_SESSION_TTL, { today: true, onError: () => {} },
  )
  const isTrainingDay = isSplitPlan(plan)
    ? trainingDayForPlanDate(logDate, today, rec)
    : undefined

  // After `isTrainingDay`: the hook needs it to pick the variant it estimates against (BF-203a).
  const {
    logMeal, logMeals, bulkLogging, loggingPosition, loggedPositions, declinedMealIds, setDeclined,
  } = usePlanMealLogging({ mealPlan: plan, mealTypes, logs, userId, dateRef, onLogged, isTrainingDay })

  return (
    <MealPlanSection
      plan={plan}
      loading={loading}
      eaten={eaten}
      isTrainingDay={isTrainingDay}
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
