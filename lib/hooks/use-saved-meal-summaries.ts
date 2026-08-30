'use client'

import { useCallback, useEffect, useState } from 'react'
import { getLocalStore } from '@/lib/local-store'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { useInvalidationRefetch } from '@/lib/hooks/use-invalidation-refetch'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

/** What a diary group's header needs from the meal it came from — its name and its picture. */
export interface SavedMealSummary {
  name: string
  imageDataUri: string | null
}

const EMPTY: ReadonlyMap<string, SavedMealSummary> = new Map()

const summarise = (meals: SavedMeal[]) =>
  new Map(meals.map(m => [m.id, { name: m.name, imageDataUri: m.imageDataUri ?? null }]))

/**
 * The saved meals, by id, for anything that needs a meal's name or photo without its ingredients
 * (BF-39's grouped diary rows).
 *
 * **Local-first, because `saved_meals` is a local-first domain.** Every write goes to the on-device
 * store and the outbox, so a UI that read only the API would show a meal renamed offline under its
 * old name until the next sync — the exact inversion CLAUDE.md's offline-first rule forbids. The
 * server list is the fallback for the web build, where `getLocalStore` returns null, and the
 * hydration for a device that has not pulled yet.
 *
 * **The cache key is `saved-meals`, shared with the library sheet and the plan picker.** A second
 * key for the same endpoint is how this app has produced stale and blank first paints before, and
 * it is what makes `invalidateSavedMeals()` reach this read.
 *
 * It re-reads on invalidation rather than on a timer: renaming a meal or giving it a photo must
 * change the diary's header, and this screen does not unmount between the two.
 */
export function useSavedMealSummaries(userId?: string): ReadonlyMap<string, SavedMealSummary> {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, SavedMealSummary>>(() => EMPTY)

  const load = useCallback(() => {
    void (async () => {
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        try {
          const local = await store.getSavedMeals()
          if (local.length > 0) { setSummaries(summarise(local)); return }
        } catch {
          // A dead local store is already reported by the sync provider; fall through to the API
          // rather than leaving the diary with no names at all.
        }
      }
      await cachedFetch<SavedMeal[]>('saved-meals', '/api/nutrition/saved-meals', TTL_MEDIUM,
        d => setSummaries(Array.isArray(d) ? summarise(d) : EMPTY)).catch(() => {})
    })()
  }, [userId])

  useEffect(() => {
    // Seeded synchronously so a repeat visit heads its meal rows on the first paint instead of
    // showing them loose for a frame and then regrouping, which reads as the list jumping.
    const seed = readCacheSync<SavedMeal[]>('saved-meals')
    if (Array.isArray(seed)) setSummaries(summarise(seed))
    load()
  }, [load])

  useInvalidationRefetch('saved-meals', load)

  return summaries
}
