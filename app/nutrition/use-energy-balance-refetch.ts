'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cachedFetch } from '@/lib/sqlite/cache'
import { fetchWithRetry } from '@trainingai/shared/fetch-with-retry'
import { ENERGY_BALANCE_TTL } from '@trainingai/shared/cache-ttl'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

export interface EnergyBalanceRefetch {
  refetch: (date: string) => void
  /** Every bounded attempt produced nothing and the screen is still mounted: the budget beside the
   *  ring is the one fetched BEFORE the write. Absent this flag, that is indistinguishable from a
   *  slow load, which is what the retry affordance needs to know. */
  failed: boolean
  /** Dismiss the failure and try again — the recovery the owner was performing by hand, twice, by
   *  switching tabs. */
  retry: () => void
  /** A refetch is in flight and nothing has painted yet. Distinct from `failed`, and the gap
   *  between them is fifteen seconds wide — see the note on `refreshing` below. */
  refreshing: boolean
}

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
 * **RV-103 — he re-reported it, and the fix could not report its own failure.** The refetch was
 * `void cachedFetch(...).catch(() => {})` with no `onError`. Per RV-84 `cachedFetch` never rejects,
 * so that `.catch` was dead code: a 500, a bad signal or offline and the refetch silently did
 * nothing, with no retry and nothing on screen saying so — landing back on exactly the stale
 * subtraction, recovered exactly as he describes, by swapping pages. Hence `fetchWithRetry`, whose
 * `onExhausted` (RV-85) is the one moment a caller can honestly distinguish a slow load from a
 * failed one, and `retry` for the persistent case.
 *
 * **The second RV-103 defect, and the worse one:** `d => setBalance(d ?? null)` wrote **null** on
 * an empty payload, and `balanceForDate` is gated on `energyBalance?.date === selectedDate` — so a
 * null or wrong-date response made the budget and the macro targets *disappear* rather than go
 * stale. A response that carries nothing is not news about the day; the previous object stays.
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
  setBalance: (b: EnergyBalanceResponse) => void,
): EnergyBalanceRefetch {
  const [failed, setFailed] = useState(false)
  // **RV-103's device FAILURE was a timing gap, not a missing channel.** Sweep 2 blocked the balance
  // route at the network and watched the card hold "320 kcal left" for 7 s with nothing said. Every
  // channel below was wired correctly; none of them could have fired yet. `fetchWithRetry` makes
  // four attempts with 2.5 s + 5 s + 7.5 s of backoff, so `onExhausted` is **15 s** away, and
  // `onRevalidateError` fires only when a cached value was painted — which the write's own
  // `invalidateNutritionWrite()` has just made sure there is not. So for fifteen seconds the screen
  // showed a pre-write number as though it were current, which is the whole complaint.
  //
  // `refreshing` is the honest thing to say during those seconds. It is not a failure and must not
  // read as one; it is "this number is being replaced".
  const [refreshing, setRefreshing] = useState(false)
  // `refetch` is called from event handlers, not an effect, so there is no cleanup to cancel it —
  // this is what stops `onExhausted` setting state on a screen that has gone away.
  //
  // **Reset on mount, not just set on unmount.** StrictMode mounts, unmounts and remounts, so a
  // cleanup-only version latches `true` on the simulated unmount and never clears it — every retry
  // and the exhaustion report are then dead for the life of the screen, which is the exact silence
  // RV-103 is about. Found by driving the real screen with the balance route aborted and counting
  // one request where four were due.
  const unmountedRef = useRef(false)
  useEffect(() => {
    unmountedRef.current = false
    return () => { unmountedRef.current = true }
  }, [])
  const lastDateRef = useRef<string | null>(null)

  const refetch = useCallback((date: string) => {
    lastDateRef.current = date
    setFailed(false)
    setRefreshing(true)
    // **Two channels, because one failure has two shapes and neither alone covers both.**
    //
    // `onExhausted` covers the post-write NORM: the write awaited `invalidateNutritionWrite()`, so
    // the key is usually empty when this runs, the retries run against nothing, and exhaustion is
    // the honest report. But `cachedFetch` gates `onError` on `cached === null` in BOTH failure
    // paths, and `fetchWithRetry` treats a cached paint as a response and stops the ladder — so
    // when a stale entry survives the invalidation, the pre-write figure sits on screen and NEITHER
    // channel fires. That residue was measured against the running screen with the balance route
    // aborted: the same code reported or stayed silent on consecutive runs, decided only by whether
    // the entry happened to be in the cache. The flake was the finding.
    //
    // `onRevalidateError` (LB-128) is that missing half. It is deliberately NOT `onError`: every
    // other caller reads `onError` as "I have nothing to show", and ungating it would replace good
    // cached data with error cards app-wide. Here the caller knows the painted value is stale,
    // because it just wrote.
    //
    // Both land on the same `setFailed(true)`, and `setFailed(false)` above makes that idempotent —
    // `onRevalidateError` can fire on more than one attempt.
    fetchWithRetry<EnergyBalanceResponse>(
      `energy-balance:${date}`, `/api/nutrition/energy-balance?date=${date}`, ENERGY_BALANCE_TTL,
      d => { if (d) { setBalance(d); setRefreshing(false) } },
      () => unmountedRef.current,
      0,
      cachedFetch,
      {
        onExhausted: () => { setFailed(true); setRefreshing(false) },
        onRevalidateError: () => { setFailed(true); setRefreshing(false) },
      },
    )
  }, [setBalance])

  const retry = useCallback(() => {
    if (lastDateRef.current) refetch(lastDateRef.current)
  }, [refetch])

  return { refetch, failed, retry, refreshing }
}
