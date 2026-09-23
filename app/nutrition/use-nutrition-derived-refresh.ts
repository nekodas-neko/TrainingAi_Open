'use client'

import { useCallback } from 'react'
import { cachedFetch } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { useInvalidationRefetch } from '@/lib/hooks/use-invalidation-refetch'
import type { NutritionAdherenceResponse } from '@/app/api/nutrition/adherence/route'

export type WeeklySummaryRow = {
  date: string; calories: number; proteinG: number; carbsG: number; fatG: number
}

/**
 * RV-104 — the 7-day calorie chart and the adherence percentages, kept fresh by subscription
 * rather than by each write path remembering them.
 *
 * Both keys were fetched **only** from `fetchMountData`, whose effect deps are stable, on a screen
 * the tab shell never unmounts — so they held their launch-time values until the app was restarted.
 * A tab switch did not help: `useRefreshOnTabShow` re-runs `fetchData` (logs + balance), never
 * `fetchMountData`. The asymmetry that made it visible: the delete path had learned to refetch
 * `nutrition-weekly-summary` by hand, and the add path had not — same screen, same quantity, one
 * updated and one did not.
 *
 * **Not another cache bust.** Both keys are already in `invalidateNutritionWrite()` and always
 * were; this is the Q-402 shape, where the eviction lands and nothing asks for a new value. So the
 * fix subscribes to the invalidation the writes already fire, which is what makes it hold for the
 * NEXT write path too — BF-177 was patched site-by-site three times and a fourth site was always
 * going to appear.
 *
 * Returns the same loader `fetchMountData` calls at mount, so the two paths cannot drift into two
 * fetch expressions for one key (the TTL-divergence rule).
 */
const KEYS = ['nutrition-weekly-summary', 'nutrition-adherence'] as const

export function useNutritionDerivedRefresh(
  setWeeklyData: (rows: WeeklySummaryRow[]) => void,
  setAdherence: (a: NutritionAdherenceResponse) => void,
): () => Promise<void> {
  const refresh = useCallback(async () => {
    await Promise.all([
      cachedFetch<WeeklySummaryRow[]>(
        'nutrition-weekly-summary', '/api/nutrition/weekly-summary', TTL_MEDIUM,
        d => setWeeklyData(Array.isArray(d) ? d : []),
      ),
      cachedFetch<NutritionAdherenceResponse>(
        'nutrition-adherence', '/api/nutrition/adherence', TTL_MEDIUM,
        d => setAdherence(d),
      ),
    ])
  }, [setWeeklyData, setAdherence])

  useInvalidationRefetch(KEYS, () => { void refresh() })

  return refresh
}
