'use client'

import { useEffect, useRef, useState } from 'react'
import {
  cachedFetch, cachedFetchToday, readCacheSync, readTodayCacheSync, subscribeToInvalidation,
} from '@/lib/sqlite/cache'

/**
 * Seed from cache, fetch, and **fetch again whenever the key is invalidated**.
 *
 * The last clause is the whole point, and it is the half the app was missing (Q-402). The standing
 * cache rule covers writing through a named group in `lib/cache-groups.ts`, and that works: the
 * entry is evicted correctly. Nothing then asked the component reading it to go and get a new one.
 * A `useEffect(…, [])` that fetches once is fine for a screen you navigate away from — it refetches
 * on the next mount — and silently wrong for anything in the **persistent tab shell**, which never
 * unmounts. Home's energy-balance card kept its first payload until the app was killed, and that is
 * what the owner reported.
 *
 * Use this instead of hand-rolling seed-then-fetch. There were 37 `useEffect(…, [])` blocks calling
 * `cachedFetch` when this was written; most are in components that do unmount, so they are latent
 * rather than broken — see **Q-359** for the sweep.
 *
 * Deliberately NOT doing two things:
 * - **No TTL shortening.** The effect never re-ran, so the TTL was never consulted; a shorter one
 *   would add load and hide the defect. The Q-402 entry says so explicitly.
 * - **No visibility gate.** An off-screen card in the shell will refetch. That is one GET against a
 *   correctness bug, and `cachedFetch` already de-dupes concurrent requests for the same key, so a
 *   write that clears several groups at once still produces one request.
 */
export function useCachedValue<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  opts?: {
    /**
     * Called when the fetch fails. `cachedFetch` swallows `!res.ok` — including this app's own rate
     * limit — so a card without this has no way to tell "no data" from "the request failed", and
     * the standing rule is that it must show an error state rather than vanishing.
     */
     onError?: () => void
    /**
     * Read and write through the today-scoped variant (`cachedFetchToday` / `readTodayCacheSync`)
     * for the date-less "today" keys, which treat an entry stored on a previous day as a miss.
     *
     * **This is not a preference — it is a property of the KEY**, and the two must never be mixed:
     * one canonical variant per key, every read site and the `sync-provider` warm list together.
     * Set it wherever the site you are converting called `cachedFetchToday`, and check the warm
     * list's `today:` flag agrees. Without this flag the hook could only ever convert half the
     * sites in the Q-359 sweep, and the other half would have to switch variant to adopt it —
     * which is the exact drift the one-variant rule exists to stop.
     */
    today?: boolean
  },
): T | null {
  const [data, setData] = useState<T | null>(null)

  // Held in a ref so a caller passing an inline arrow — which is every caller — does not re-run the
  // fetch effect on each render.
  const onErrorRef = useRef(opts?.onError)
  onErrorRef.current = opts?.onError

  const today = opts?.today ?? false

  // Seed in an effect, never a useState initializer — a cache read in an initializer causes a
  // hydration mismatch (session 165).
  useEffect(() => {
    const seed = today ? readTodayCacheSync<T>(key) : readCacheSync<T>(key)
    if (seed) setData(seed)
  }, [key, today])

  // `alive` guards against a response landing after unmount or after `key` changed.
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    let alive = true
    const fetcher = today ? cachedFetchToday : cachedFetch
    const load = () => {
      void fetcher<T>(key, url, ttlSeconds, d => {
        if (alive && keyRef.current === key) setData(d ?? null)
      }, { onError: () => { if (alive && keyRef.current === key) onErrorRef.current?.() } })
    }
    load()

    const unsubscribe = subscribeToInvalidation(prefix => {
      // A group may clear a broader prefix than this key (`energy-balance:` against
      // `energy-balance:2026-08-19`) or clear the exact key. Match either direction.
      if (key.startsWith(prefix) || prefix.startsWith(key)) load()
    })

    return () => { alive = false; unsubscribe() }
  }, [key, url, ttlSeconds, today])

  return data
}
