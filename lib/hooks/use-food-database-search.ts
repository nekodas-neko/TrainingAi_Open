'use client'

import { useEffect, useState } from 'react'
import type { FoodSearchResponse } from '@/app/api/nutrition/food-search/route'

export type ExternalFood = FoodSearchResponse['results'][number]

/** Below two characters OFF returns the world index, which is noise rather than an answer. */
const MIN_QUERY_LENGTH = 2

/**
 * Open Food Facts rate-limits searches to roughly ten a minute, so typing "chicken breast" at the
 * 250 ms debounce the own-foods search uses is enough to get 503ed. The long pause before asking is
 * what keeps the answer coming back at all — it is not a spare knob.
 */
const DEBOUNCE_MS = 700

export interface FoodDatabaseSearch {
  results: ExternalFood[]
  searching: boolean
  /** The database did not answer. Distinct from "no results", which is an answer. */
  unavailable: boolean
}

/**
 * Searching the food database (Open Food Facts), on its own slower clock.
 *
 * Extracted from `ingredient-picker.tsx` for BF-48, where the owner found that Log Food → Single
 * foods searched only what he had already logged: the database was reachable **only** from inside
 * the meal builder, so getting one new food into the diary meant building a meal around it. Both
 * screens now call this.
 *
 * It stays a hook rather than a `cachedFetch` key because the two properties that matter here are
 * the debounce and the cancellation, and neither belongs to a cache: results are per-keystroke and
 * a stale one must never land after a newer query. Nothing here is cached at all — a third-party
 * index that rate-limits and goes down is exactly the thing not to serve from memory as though it
 * were the user's own data.
 */
export function useFoodDatabaseSearch(query: string, active: boolean): FoodDatabaseSearch {
  const [results, setResults] = useState<ExternalFood[]>([])
  const [searching, setSearching] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!active) return
    if (query.trim().length < MIN_QUERY_LENGTH) { setResults([]); setUnavailable(false); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/nutrition/food-search?q=${encodeURIComponent(query)}`)
        const d = await res.json() as FoodSearchResponse
        if (!cancelled) {
          setResults(Array.isArray(d.results) ? d.results : [])
          setUnavailable(!!d.unavailable)
        }
      } catch {
        if (!cancelled) { setResults([]); setUnavailable(true) }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, active])

  return { results, searching, unavailable }
}
