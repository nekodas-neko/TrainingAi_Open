'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { History } from 'lucide-react'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { EmptyState } from '@/components/ui/empty-state'
import { FoodRow } from './food-row'

interface Props {
  /**
   * The bucket to read recency from — the one the sheet was opened on, or the time-of-day one the
   * parent resolved. Null while the meal types are still loading, which renders as loading rather
   * than as "nothing here".
   */
  mealTypeId: string | null
  userId?: string
  onSelectFood: (item: FoodItem) => void
}

/**
 * `Recent` — what you last logged, as the screen's default content (LB-16).
 *
 * **It is scoped to a meal bucket, and that is a data limit rather than a design choice.** The only
 * recency source the app has is `listRecentFoodItemsForMealType`, on both the server route and the
 * local store; there is no unfiltered "recent food items" query on either side, and adding one
 * touches `app/api/**` and `lib/local-store/**`, which is Lane A's. So the parent resolves a bucket
 * — the preselected one, else `mealTypeForHour` — and this reads that.
 *
 * It reads defensibly rather than merely acceptably: opening Log Food at 7 pm and being shown what
 * you usually eat at dinner beats a global list topped by breakfast coffee. If use says otherwise,
 * the swap is this component's fetch and nothing else.
 *
 * Local-first, because `getRecentFoodItemsForMeal` works offline and the network read is only a
 * revalidation — the same shape the strip this replaced already used.
 */
export function RecentFoodsPanel({ mealTypeId, userId, onSelectFood }: Props) {
  const [items, setItems] = useState<FoodItem[]>([])
  const [loaded, setLoaded] = useState(false)

  // Seeded in an effect, never a `useState` initializer — a cache read in an initializer is the
  // hydration mismatch CLAUDE.md's instant-paint rule names.
  useLayoutEffect(() => {
    if (!mealTypeId) return
    const seeded = readCacheSync<FoodItem[]>(`nutrition-recent-for-meal:${mealTypeId}`)
    if (Array.isArray(seeded)) { setItems(seeded); setLoaded(true) }
  }, [mealTypeId])

  useEffect(() => {
    if (!mealTypeId) return
    let cancelled = false
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      store.getRecentFoodItemsForMeal(mealTypeId, 12)
        .then(local => { if (!cancelled && local.length > 0) { setItems(local); setLoaded(true) } })
        .catch(() => {})
    }
    cachedFetch<FoodItem[]>(
      `nutrition-recent-for-meal:${mealTypeId}`,
      `/api/nutrition/recent-for-meal?mealTypeId=${mealTypeId}`,
      TTL_MEDIUM,
      list => { if (!cancelled && Array.isArray(list)) { setItems(list); setLoaded(true) } },
    ).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [mealTypeId, userId])

  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={loaded ? 'Nothing logged here yet. Scan or search for a food and it will show up next time.' : 'Loading…'}
      />
    )
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/50">
      {items.map(item => (
        <RecentRow key={item.id} item={item} onSelectFood={onSelectFood} />
      ))}
    </div>
  )
}

/**
 * Its own memoised component so the press handler is a `useCallback` rather than an inline arrow — a
 * hook is unavailable inside the `.map()` above, and an inline arrow at the call site would silently
 * defeat `FoodRow`'s `memo()` (Q-490, and `scripts/check-memo-prop-stability.js` enforces it).
 */
const RecentRow = memo(function RecentRow(
  { item, onSelectFood }: { item: FoodItem; onSelectFood: (item: FoodItem) => void },
) {
  const press = useCallback(() => onSelectFood(item), [item, onSelectFood])
  return (
    <FoodRow
      name={item.brand ? `${item.brand} — ${item.name}` : item.name}
      secondary={item.servingSizeG > 0 ? `${Math.round(item.servingSizeG)} g serving` : null}
      calories={item.calories}
      onPress={press}
    />
  )
})
