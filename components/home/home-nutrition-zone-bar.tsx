'use client'

import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'
import { CalorieZoneBar } from '@/components/nutrition/calorie-zone-bar'

/**
 * Home's nutrition card bar (Q-401).
 *
 * **Replaces a gradient progress fill**, and the difference is the point: a fill answers "how full
 * is the tank" against a target that never moves, which is the wrong question once the budget rises
 * with what you actually burn. The zone answers "am I on target", and the line under it says where
 * the budget came from — otherwise a number that changes during the day looks like a bug, which is
 * how Q-401 was reported.
 *
 * Self-fetching through `useEnergyBalanceToday` rather than threaded through the Home orchestrator,
 * matching `HomeEnergyBalanceCard` beside it: the payload is this element's alone, both share one
 * cache key so `cachedFetch` de-dupes them into a single request, and the hook is on
 * `useCachedValue` so an invalidation repaints it (Q-402 — the bug that made this card need an app
 * restart).
 *
 * Renders nothing without a balance, which is the same condition under which the old fill rendered
 * nothing: the card keeps its ring, its totals and its macro rows either way.
 */
export function HomeNutritionZoneBar() {
  const data = useEnergyBalanceToday()
  const b = data?.balance
  if (!b) return null

  return (
    <div className="mb-1.5">
      <CalorieZoneBar
        compact
        deviationKcal={b.deviationKcal}
        zoneColor={b.zoneColor}
        restingBaseKcal={b.restingBaseKcal}
        activeKcal={b.activeKcal}
        targetNetKcal={b.targetNetKcal}
      />
    </div>
  )
}
