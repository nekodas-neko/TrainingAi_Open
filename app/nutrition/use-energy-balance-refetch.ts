'use client'

import { useCallback } from 'react'
import { cachedFetch } from '@/lib/sqlite/cache'
import { ENERGY_BALANCE_TTL } from '@trainingai/shared/cache-ttl'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

/**
 * BF-177 — refetch the day's energy balance, and nothing else.
 *
 * The owner: *"The kcal left in the top right; doesnt load on the same page: it requires page
 * switching to show."*
 *
 * **The cache bust he proposed already existed.** `logFoodEntries` calls
 * `invalidateNutritionWrite()`, which clears `energy-balance:`. This is the Q-402 shape CLAUDE.md
 * names — *"invalidating a key and re-rendering the component that reads it are two different
 * things"* — so adding another invalidation would have changed nothing. The optimistic branch of
 * `handleFoodLogged` appended to `logs` and returned, leaving `energyBalance` holding the object
 * fetched before the meal: the ring moved, the subtraction beside it did not.
 *
 * **Why a balance-only fetch and not `fetchData`.** `fetchData` also runs `loadFoodLogs`, which
 * would re-fetch the very list just appended to optimistically and can clobber or flicker the row
 * the user is looking at.
 *
 * **Why not derive `remaining` on the client, which is the trap.** `remainingKcal` is
 * `-deviationKcal`, and `zoneLabel`, `zoneColor` and the bar all come off that same number
 * (`calorie-balance.ts:131-138`). Making only the figure live would print "871 kcal left" beside a
 * band and a bar that had not moved — one visible disagreement traded for a subtler one.
 * `calorie-balance.ts:111` is explicit that every "left"/"over" reading comes off one number.
 *
 * **Accepted:** the ring updates instantly and "kcal left" lands a round trip later. The budget
 * half genuinely comes from the server, and that gap is far smaller than waiting for a tab change.
 *
 * Extracted rather than inlined because `nutrition-content.tsx` sits against the hard 800-line
 * limit — appending this reasoning to it took the file to 811.
 */
export function useEnergyBalanceRefetch(
  setBalance: (b: EnergyBalanceResponse | null) => void,
): (date: string) => void {
  return useCallback((date: string) => {
    void cachedFetch<EnergyBalanceResponse>(
      `energy-balance:${date}`, `/api/nutrition/energy-balance?date=${date}`, ENERGY_BALANCE_TTL,
      d => setBalance(d ?? null),
    ).catch(() => {})
  }, [setBalance])
}
