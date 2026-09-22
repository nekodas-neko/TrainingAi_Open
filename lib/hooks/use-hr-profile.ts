'use client'

import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import type { HrProfileResponse } from '@/app/api/hr-profile/route'

/**
 * The user's HR profile — observed and estimated max, and the zones derived from them.
 *
 * **Owns the key, the URL and the TTL for every workout-flow reader (RV-64).** `LiveHrChart` read
 * them itself, in a mount-once effect, and the active workout mounts that chart on
 * `workoutPhase === "rest"` — so it remounted once per rest period and a 5×4 workout paid the
 * ~230 ms path around twenty times *during the workout*, against the same ten-connection pool as
 * `log-exercise` and `complete-workout`. The route's 20-per-60s limit meant a dense rest cadence
 * could make the chart 429 itself. Hoisting the read to the screens that stay mounted takes those
 * twenty calls to one.
 *
 * **Why not `freshWithinTtl: true`, which RV-64 also offered.** That flag needs every writer of the
 * payload to sit in a group that clears the key, and one does not. The profile is computed from
 * `getHrForWindow` over 90 days, and live BLE samples land in that window *during the workout* —
 * ingested natively, server-side, with nothing in `lib/live-hr/**` invalidating anything. Only
 * `invalidateOuraSync` and `invalidateBodyMetricWrite` clear `hr-profile`, so the flag would pin a
 * profile for up to six hours across workouts rather than for one. Hoisting bounds the staleness to
 * a single screen's lifetime instead, which is the trade the entry actually asked for.
 */
export function useHrProfile(): HrProfileResponse | null {
  return useCachedValue<HrProfileResponse>('hr-profile', '/api/hr-profile', HR_PROFILE_TTL)
}
