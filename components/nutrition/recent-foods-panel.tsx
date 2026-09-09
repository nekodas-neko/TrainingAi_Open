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
  userId?: string
  onSelectFood: (item: FoodItem) => void
}

/**
 * Under the `nutrition-recent-for-meal:` prefix on purpose, not beside it. `invalidateCache` deletes
 * `WHERE key LIKE 'prefix%'` and `invalidateFoodLogWrites()` clears that exact prefix, so this key is
 * already evicted by every food write. A name outside the family — `nutrition-recent-all` — would
 * have needed a new group in `lib/cache-groups.ts`, which is not this lane's file.
 */
const RECENT_KEY = 'nutrition-recent-for-meal:all'

/**
 * `Recent` — what you last logged, as the screen's default content (LB-16, LB-18).
 *
 * **Every bucket, not the one the hour suggests.** It used to scope to a meal type, which was a data
 * limit rather than a choice: there was no unfiltered recency query on either side. The owner
 * answered it on the device — *"Recent doesnt need to be scoped to current meal bracket; I think it
 * should just be all recently entered foods/meals"* — and the sources landed in LB-18's Lane A half,
 * so this is the swap that entry predicted: *"the swap is this component's fetch and nothing else."*
 *
 * A consequence worth keeping: nothing here waits on the meal types any more, so the list paints as
 * soon as the sheet opens rather than after a bucket resolves.
 *
 * Local-first, because `getRecentFoodItems` works offline and the network read is only a
 * revalidation — the same shape the strip this replaced already used.
 */
export function RecentFoodsPanel({ userId, onSelectFood }: Props) {
  const [items, setItems] = useState<FoodItem[]>([])
  const [loaded, setLoaded] = useState(false)

  // Seeded in an effect, never a `useState` initializer — a cache read in an initializer is the
  // hydration mismatch CLAUDE.md's instant-paint rule names.
  useLayoutEffect(() => {
    const seeded = readCacheSync<FoodItem[]>(RECENT_KEY)
    if (Array.isArray(seeded)) { setItems(seeded); setLoaded(true) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const store = userId ? getLocalStore(userId) : null
    if (store) {
      store.getRecentFoodItems(12)
        .then(local => { if (!cancelled && local.length > 0) { setItems(local); setLoaded(true) } })
        .catch(() => {})
    }
    // No `mealTypeId` param: the route treats its absence as every bucket and returns 12 rather
    // than 5, which is the Lane A half of LB-18.
    cachedFetch<FoodItem[]>(
      RECENT_KEY,
      '/api/nutrition/recent-for-meal',
      TTL_MEDIUM,
      list => { if (!cancelled && Array.isArray(list)) { setItems(list); setLoaded(true) } },
    ).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [userId])

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
