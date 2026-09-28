'use client'

import { useEffect, useState } from 'react'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { BODY_BATTERY_TTL } from '@trainingai/shared/cache-ttl'
import type { BodyBatteryResponse } from '@/app/api/body-battery/route'

/**
 * Home's body-battery read: the cached seed, the revalidation, and whether the last attempt failed.
 *
 * Extracted from `session-select-content.tsx` (LB-175), which is a size-ratcheted hotspot — the
 * failure flag this entry adds would otherwise have been an append to it, and the standing answer
 * to that refusal is the extraction rather than trimming comments to squeeze under. The read had
 * three pieces in two places already: a `readTodayCacheSync` seed inside a larger mount effect and
 * a fetch effect two hundred lines below it.
 *
 * **The seed runs in an effect, never a `useState` initializer.** A cache read in an initializer
 * executes on the server too, which is the documented hydration-mismatch pattern this repo has
 * been bitten by.
 */
export function useBodyBattery(refreshTick: number): {
  battery: BodyBatteryResponse | null
  /** The last attempt failed AND there is nothing cached to show — the only case worth a line. */
  failed: boolean
} {
  const [battery, setBattery] = useState<BodyBatteryResponse | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    try {
      const cached = readTodayCacheSync<BodyBatteryResponse>('body-battery')
      if (cached) setBattery(cached)
    } catch { /* a blocked store is not worth failing a render over */ }
  }, [])

  useEffect(() => {
    void cachedFetchToday<BodyBatteryResponse>(
      'body-battery', '/api/body-battery', BODY_BATTERY_TTL,
      d => { if (d) { setBattery(d); setError(false) } },
      // `cachedFetch` swallows `!res.ok` and its promise resolves a boolean rather than rejecting
      // (RV-84), so the `.catch` that used to sit here could never fire: on a cold start with the
      // route down the card was simply absent, the one section on Home that vanished in silence.
      { onError: () => setError(true) },
    ).catch(() => {})
  }, [refreshTick])

  // A stale arc beats a banner, which is the posture every other read on this screen takes.
  return { battery, failed: error && battery == null }
}
