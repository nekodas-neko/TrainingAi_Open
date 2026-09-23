'use client'

import { useCallback } from 'react'
import { cachedFetch } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'
import { useInvalidationRefetch } from '@/lib/hooks/use-invalidation-refetch'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'

/**
 * RV-107 — the day's macro targets, kept current by subscription.
 *
 * `macro-targets-pane.tsx` POSTs and then awaits `invalidateGoalRecommendations()`, which clears
 * `nutrition-targets`; applying a goal recommendation from Home goes through the same group.
 * Nutrition read the key only from `fetchMountData`, at `TTL_LONG`, on a screen the tab shell never
 * unmounts — so the macro rings kept banding against the previous target for the life of the app.
 * The Q-402 shape again: the eviction landed and nothing asked for a new value.
 *
 * **The proof was already in the file.** `TdeeAdaptationCard`'s `onApplied` refetched this key by
 * hand — one write path that got the treatment while its siblings did not, which is the same
 * site-by-site pattern BF-177 was patched with three times. That call site now uses this hook, so
 * the key has ONE fetch expression rather than two identical ones (the TTL-divergence rule), and
 * every future write path is covered without having to remember.
 *
 * Kept separate from `useNutritionDerivedRefresh` deliberately: that one belongs to
 * `invalidateNutritionWrite`, this one to `invalidateGoalRecommendations`. Bundling them would make
 * a food log refetch the targets and a target edit refetch the weekly chart, and would hide which
 * write each subscription is actually protecting against.
 */
export function useNutritionTargetsRefresh(
  setTargets: (t: NutritionTargets | null) => void,
): () => Promise<void> {
  const refresh = useCallback(async () => {
    await cachedFetch<NutritionTargets>(
      'nutrition-targets', '/api/nutrition/targets', TTL_LONG,
      d => setTargets(d ?? null),
    )
  }, [setTargets])

  useInvalidationRefetch('nutrition-targets', () => { void refresh() })

  return refresh
}
