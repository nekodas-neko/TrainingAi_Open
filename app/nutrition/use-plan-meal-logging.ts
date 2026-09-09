'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { toast } from 'sonner'
import type { FoodLogWithItem, MealPlan, MealPlanMeal, MealType } from '@trainingai/shared/types/nutrition'
import { logPlanMeal } from '@trainingai/shared/nutrition/log-plan-meal'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'

interface Options {
  mealPlan: MealPlan | null
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  userId?: string
  /** Read at call time, not render time — the user can change day mid-request. */
  dateRef: { current: string }
  onLogged: (log: FoodLogWithItem) => void
}

/**
 * Logging a planned meal as eaten, from the plan card.
 *
 * Q-187's shippable half. The full prefill fills the day in automatically and therefore needs a
 * "prefilled but unconfirmed" state, so the energy-balance bar never reports food nobody ate. Here
 * the user taps, so **the tap is the confirmation** — no new state, no new table, and nothing can
 * count toward the day's totals unless they said they ate it.
 */
export function usePlanMealLogging({ mealPlan, mealTypes, logs, userId, dateRef, onLogged }: Options) {
  // Q-413: the eaten-at resolution happens in the USER's zone, not the device's.
  const tz = useUserTimezone()
  const [loggingPosition, setLoggingPosition] = useState<number | null>(null)

  /**
   * Which planned meals are already logged, **derived** rather than stored.
   *
   * A plan meal has no per-day row, and inventing one just to remember a button press is the start
   * of exactly the unconfirmed-row design phase 2 has to do properly. Matching on the ingredient
   * names the meal would write is enough to stop an accidental double-log, and it self-corrects:
   * delete the food and the button comes back.
   */
  const loggedPositions = useMemo(() => {
    const names = new Set(
      logs.map(l => l.foodItem?.name?.toLowerCase()).filter((n): n is string => !!n),
    )
    const variant = mealPlan?.variants[0]
    if (!variant || names.size === 0) return new Set<number>()
    return new Set(
      variant.meals
        .filter(m => m.ingredients.length > 0
          && m.ingredients.every(i => names.has(i.name.toLowerCase())))
        .map(m => m.position),
    )
  }, [logs, mealPlan])

  /**
   * Log several planned meals in one action (Q-187 step 4).
   *
   * **Sequential on purpose, and this is the one place it is right to be.** The standing rule is
   * never to await POSTs in a loop — but on the canonical runtime `logPlanMeal` makes no network
   * call at all: it writes SQLite, queues the outbox and fires `pushThenRevalidate` behind itself.
   * Running the meals concurrently would interleave those writes on one connection and start N
   * pushes and N cache invalidations for no gain. The user does not wait on any of it: the button
   * flips synchronously and each meal's rows appear as it lands.
   *
   * One failing meal does not strand the rest — the same reason the outbox quarantines a poison
   * mutation instead of stopping the queue behind it — and the count that failed is reported rather
   * than swallowed.
   */
  const [bulkLogging, setBulkLogging] = useState(false)
  // A ref, not the state above: two taps inside one render both read the old `false`, which is how
  // this app once turned 5 taps into 4 POSTs.
  const bulkRef = useRef(false)

  const logMeals = useCallback(async (meals: MealPlanMeal[]) => {
    if (bulkRef.current || meals.length === 0) return
    bulkRef.current = true
    setBulkLogging(true)
    let logged = 0
    let failed = 0
    try {
      for (const meal of meals) {
        try {
          const written = await logPlanMeal(
            {
              name: meal.name,
              ingredients: meal.ingredients,
              mealTypeId: meal.mealTypeId,
              suggestedTime: meal.suggestedTime,
            },
            mealTypes,
            dateRef.current,
            userId,
            new Date(),
            tz,
          )
          for (const log of written) onLogged(log)
          logged++
        } catch {
          failed++
        }
      }
    } finally {
      bulkRef.current = false
      setBulkLogging(false)
    }
    if (logged > 0) toast.success(`${logged} ${logged === 1 ? 'meal' : 'meals'} logged`)
    if (failed > 0) toast.error(`${failed} could not be logged`)
  }, [mealTypes, userId, dateRef, onLogged, tz])

  const logMeal = useCallback(async (meal: MealPlanMeal) => {
    setLoggingPosition(meal.position)
    try {
      const written = await logPlanMeal(
        {
          name: meal.name,
          ingredients: meal.ingredients,
          mealTypeId: meal.mealTypeId,
          suggestedTime: meal.suggestedTime,
        },
        mealTypes,
        dateRef.current,
        userId,
        new Date(),
        tz,
      )
      toast.success(`${meal.name} logged`)
      for (const log of written) onLogged(log)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not log that meal')
    } finally {
      setLoggingPosition(null)
    }
  }, [mealTypes, userId, dateRef, onLogged, tz])

  // ── Declines (Q-187 phase 2) ─────────────────────────────────────────────
  //
  // "I did not eat this" is the half that is NOT derivable: an absent food log is
  // indistinguishable from an unanswered prompt, and a prefill that keeps re-asking after being
  // declined is worse than no prefill. "Ate it" stays derived above, from the food itself.
  //
  // Nothing here touches `food_logs`, which is the property the whole design protects: a declined —
  // or unanswered — meal cannot move the day's totals, because there is no row to move them.
  const [declinedMealIds, setDeclinedMealIds] = useState<Set<string>>(new Set())

  /**
   * Answers made on this device that a read has not agreed with yet.
   *
   * `loadAnswers` re-runs while the card is on screen, so a read can already be in flight when the
   * user taps — and it returns the state from *before* the tap. Applying it verbatim silently undid
   * the answer, which is the optimistic-write rule this repo learned from the mood-checkin
   * re-prompt, in the one place where nothing else can reveal it: a decline writes no food and
   * moves no total, so the only sign it was lost is the meal asking again. Measured on the web path
   * while covering this surface — the revert reproduced on two runs in three.
   *
   * An override is dropped the moment a read agrees with it, so this converges rather than pinning
   * the value against the server.
   *
   * **Keyed by day as well as meal**, because a plan meal keeps the same id on every day it is
   * planned for: keyed by meal alone, an override would out-vote a read for a *different* day that
   * correctly has no answer, and could never be dropped, because such a read can never agree with
   * it. That is belt-and-braces rather than a fixed bug — the plan card renders only on today, so
   * nothing currently reaches this hook with a second date, and there is no way to assert it from
   * the screen. It costs one string join and stops the guard from becoming wrong if that changes.
   */
  const pendingAnswers = useRef(new Map<string, boolean>())
  const answerKey = (date: string, mealId: string) => `${date}:${mealId}`

  const applyAnswers = useCallback((date: string, serverIds: string[]) => {
    const server = new Set(serverIds)
    const next = new Set(server)
    for (const [key, declined] of pendingAnswers.current) {
      const [keyDate, mealId] = key.split(':')
      if (keyDate !== date) continue
      if (server.has(mealId) === declined) { pendingAnswers.current.delete(key); continue }
      if (declined) next.add(mealId); else next.delete(mealId)
    }
    setDeclinedMealIds(next)
  }, [])

  const loadAnswers = useCallback(async (date: string) => {
    if (!userId) return
    // Local-first: a decline made offline must survive an app restart, or the prompt reappears.
    const store = getLocalStore(userId)
    if (store) {
      try {
        const rows = await store.getPlanMealAnswers(date)
        applyAnswers(date, rows.map(r => r.planMealId))
        return
      } catch { /* fall through to the online read */ }
    }
    try {
      const res = await fetch(`/api/nutrition/plan-meal-answers?date=${date}`)
      if (!res.ok) return
      const data = await res.json() as { answers?: { planMealId: string }[] }
      applyAnswers(date, (data.answers ?? []).map(a => a.planMealId))
    } catch { /* offline and no store — leave the set as it is */ }
  }, [userId, applyAnswers])

  useEffect(() => { void loadAnswers(dateRef.current) }, [loadAnswers, dateRef, mealPlan?.id])

  const setDeclined = useCallback(async (meal: MealPlanMeal, declined: boolean) => {
    if (!userId) return
    const date = dateRef.current
    // Flip first: the tap is the feedback, and the write reconciles behind it. The override is
    // recorded in the same breath, so a read already in flight cannot land on top of it.
    pendingAnswers.current.set(answerKey(date, meal.id), declined)
    setDeclinedMealIds(prev => {
      const next = new Set(prev)
      if (declined) next.add(meal.id); else next.delete(meal.id)
      return next
    })
    const store = getLocalStore(userId)
    let queued = false
    if (store) {
      try {
        const now = new Date().toISOString()
        if (declined) {
          await store.upsertPlanMealAnswer({
            id: crypto.randomUUID(), planMealId: meal.id, logDate: date,
            answer: 'no', answeredAt: now, updatedAt: now, deletedAt: null,
          })
        } else {
          await store.deletePlanMealAnswer(meal.id, date)
        }
        await store.queueMutation({
          userId, domain: 'plan_meal_answers', date,
          payload: { planMealId: meal.id, logDate: date, ...(declined ? {} : { deleted: true }) },
        })
        queued = true
        pushMutations(userId).catch(() => {})
      } catch { /* dead local store — fall through to the API */ }
    }
    if (!queued) {
      try {
        await fetch('/api/nutrition/plan-meal-answers', {
          method: declined ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planMealId: meal.id, logDate: date }),
        })
      } catch {
        toast.error('Saved on this device only — it will sync when you are back online')
      }
    }
  }, [userId, dateRef])

  return { logMeal, logMeals, bulkLogging, loggingPosition, loggedPositions, declinedMealIds, setDeclined }
}
