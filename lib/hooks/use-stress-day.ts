'use client'

import { useState } from 'react'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { BODY_BATTERY_TTL } from '@trainingai/shared/cache-ttl'
import type { StressDayResponse } from '@/app/api/body-battery/stress-day/route'

/**
 * A day's stress series, on the one key every reader of it shares.
 *
 * Extracted when the HR chart became a second consumer (TN-3b). The key, the URL and the TTL are
 * the three things that must agree across every call site — a second name for the same number is
 * what drifts, and `check-cache-ttl-divergence.js` fails the build on exactly that. Keeping them
 * here means a new reader cannot get any of them wrong.
 *
 * **The date is in the key rather than a today-scoped variant**, so a chart re-fetches by itself
 * across midnight instead of holding yesterday's shape in the persistent tab shell.
 *
 * `failed` exists because `cachedFetch` swallows `!res.ok` — including this route's own rate limit.
 * Without it a consumer cannot tell "no stress recorded" from "the request failed", and the
 * standing rule is that it must say so rather than render nothing.
 */
export function useStressDay(day: string): { data: StressDayResponse | null; failed: boolean } {
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<StressDayResponse>(
    `stress-day:${day}`,
    `/api/body-battery/stress-day?date=${day}`,
    BODY_BATTERY_TTL,
    { onError: () => setFailed(true) },
  )
  return { data: data ?? null, failed }
}
