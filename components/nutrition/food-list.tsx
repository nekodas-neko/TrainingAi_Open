'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FoodRow } from './food-row'
import { SavedMealCard } from './saved-meal-card'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import type { FoodItem, SavedMeal } from '@trainingai/shared/types/nutrition'

const ALL_ITEMS_KEY = 'nutrition-food-items-all'

interface Props {
  /**
   * Which kind this instance draws (BF-37). One component, two tabs — the split is presentational,
   * because the separation the owner asked for already existed *inside* here: a food row and a meal
   * row have never shared a shape or a tap destination. What changed is that they no longer share a
   * scroll.
   */
  show: 'meals' | 'foods'
  meals: SavedMeal[]
  loadingMeals: boolean
  query: string
  onQueryChange: (q: string) => void
  /** Non-null puts the list in selection mode. Meals only — a food has nothing to bulk-delete. */
  selectedIds: Set<string> | null
  onToggleSelected: (meal: SavedMeal) => void
  onOpenMeal: (meal: SavedMeal) => void
  onEditMeal: (meal: SavedMeal) => void
  onRequestDeleteMeal: (meal: SavedMeal) => void
  onLabelMeal: (meal: SavedMeal) => void
  planSavedMealIds: Set<string>
  onBuildFirst: () => void
  /**
   * A food's tap goes to the **assign** step — pick a meal type, pick a quantity — which lives in
   * `FoodLoggerSheet`. Required, because a list that cannot open a food row must not draw one, and
   * the logger is the only way in here (Q-395c).
   */
  onSelectFood: (item: FoodItem) => void
  userId?: string
}

/**
 * One component, two lists (Q-395c, then BF-37).
 *
 * A **food** is a `food_items` row that opens the assign step; a **meal** is a `saved_meals` recipe
 * that opens its own screen (BF-30). Two row shapes, two tap behaviours — that much never changed.
 *
 * **What changed twice is whether they share a scroll.** Q-395c merged them, reading the owner's
 * *"whats the difference"* as *one list wearing two names*. The report that followed
 * (*"my foods combined saved meals + history thats not right they are 2 seperate things"*) says the
 * complaint was narrower: two lists that could not be told apart. So they are two lists again — as
 * sibling tabs, where the strip does the telling-apart that two separately-reached sheets could not,
 * and `show` picks which one this instance is.
 *
 * **Ordered `createdAt DESC`, which is not most-recently-used.** `food_logs` carries no
 * `saved_meal_id`, so logging a saved meal leaves no record of which meal produced the rows and a
 * meal has **no last-used timestamp at all**. Creation time is the only recency signal the two
 * share; it still keeps a newly-saved meal off the bottom, which is what the requirement wanted.
 * True MRU needs a column that does not exist yet.
 *
 * **Extracted rather than appended.** `saved-meals-sheet.tsx` was 753 lines against the 800-line
 * component limit, and the repo's rule is that a hotspot absorbs new features into a child instead
 * of growing.
 */
export function FoodList({
  show, meals, loadingMeals, query, onQueryChange, selectedIds, onToggleSelected,
  onOpenMeal, onEditMeal, onRequestDeleteMeal, onLabelMeal, planSavedMealIds,
  onBuildFirst, onSelectFood, userId,
}: Props) {
  const [foods, setFoods] = useState<FoodItem[]>([])

  // Seed synchronously so a repeat open paints the last-known list instead of an empty panel.
  useLayoutEffect(() => {
    const seeded = readCacheSync<FoodItem[]>(ALL_ITEMS_KEY)
    if (Array.isArray(seeded)) setFoods(seeded)
  }, [])

  useEffect(() => {
    // Only the foods tab needs them. `show` is a dep rather than a remount guard because the two
    // tabs render this component at the same position, so React reuses the instance and an effect
    // keyed on anything else would never re-run on the switch.
    if (show !== 'foods') return
    let cancelled = false
    const t = setTimeout(async () => {
      // Local-first: instant matches from previously-logged foods, which works offline.
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        try {
          const local = await store.searchFoodItems(query)
          if (!cancelled) setFoods(local)
        } catch {}
      }
      if (!query.trim()) {
        cachedFetch<FoodItem[]>(ALL_ITEMS_KEY, '/api/nutrition/food-items?q=', TTL_MEDIUM,
          d => { if (!cancelled && Array.isArray(d)) setFoods(d) }).catch(() => {})
        return
      }
      try {
        const res = await fetch(`/api/nutrition/food-items?q=${encodeURIComponent(query)}`)
        const d = await res.json()
        if (!cancelled && Array.isArray(d)) setFoods(d)
      } catch {}
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [show, query, userId])

  // Matches the meal name and its ingredients, so "oats" finds a breakfast that contains oats even
  // when the meal is called something else. Foods are filtered by the route/store, not here.
  const visibleMeals = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return meals
    return meals.filter(m =>
      m.name.toLowerCase().includes(q) || m.items.some(i => i.foodItem?.name?.toLowerCase().includes(q)))
  }, [meals, query])

  const rows = useMemo(() => {
    if (show === 'meals') {
      return visibleMeals
        .map(m => ({ kind: 'meal' as const, at: +new Date(m.createdAt), meal: m }))
        .sort((a, b) => b.at - a.at)
    }
    return foods
      .map(f => ({ kind: 'food' as const, at: +new Date(f.createdAt ?? 0), food: f }))
      .sort((a, b) => b.at - a.at)
  }, [show, visibleMeals, foods])

  const empty = show === 'meals' ? meals.length === 0 : foods.length === 0

  if (show === 'meals' && loadingMeals && empty) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      {/* Search earns its place once the library grows — generated plan meals land here too, so this
          list gets long faster than a hand-built one would. */}
      {!empty && (
        <div className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-none" />
          <input
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder={show === 'meals' ? 'Search your meals' : 'Search your foods'}
            aria-label={show === 'meals' ? 'Search your meals' : 'Search your foods'}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => onQueryChange('')} aria-label="Clear search" className="p-2 -m-2 text-muted-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          {show === 'meals' ? (
            <>
              <p className="text-sm text-muted-foreground">No meals saved yet.</p>
              {/* `onClick={onBuildFirst}` would hand React's click event to the parent's
                  `openBuild(meal?)`, which then reads `meal.items` off it and throws. TypeScript
                  cannot see it: `() => void` accepts a handler taking more parameters. The sibling
                  "New" button in the sheet header already calls it this way. */}
              <Button onClick={() => onBuildFirst()}>Build your first meal</Button>
            </>
          ) : (
            // No action offered: this list fills itself. Every food you log is added to it, so the
            // useful instruction is "go log something", not a button that would only reach the
            // meal builder — a different thing entirely, which is the confusion BF-37 is undoing.
            <p className="text-sm text-muted-foreground">
              Single foods land here once you have logged them.
            </p>
          )}
        </div>
      ) : rows.length === 0 ? (
        // Non-empty above, so this is a search that matched nothing — say so rather than rendering
        // an empty panel that reads as "your food vanished".
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing matches &ldquo;{query}&rdquo;.</p>
          <Button variant="secondary" size="sm" onClick={() => onQueryChange('')}>Clear search</Button>
        </div>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {rows.length} item{rows.length === 1 ? '' : 's'}
          </p>
          {/* One grouped card, not a stack of them (artboard 3). Separate cards gave every row its
              own border and the list stopped reading as a list. */}
          <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border">
            {rows.map(row => row.kind === 'meal' ? (
              <SavedMealCard
                key={row.meal.id}
                meal={row.meal}
                selected={selectedIds ? selectedIds.has(row.meal.id) : null}
                onToggleSelected={onToggleSelected}
                onOpen={onOpenMeal}
                onEdit={onEditMeal}
                onRequestDelete={onRequestDeleteMeal}
                onLabel={onLabelMeal}
                fromPlan={planSavedMealIds.has(row.meal.id)}
              />
            ) : (
              <FoodListRow key={row.food.id} item={row.food} onSelect={onSelectFood} />
            ))}
          </div>
          {/* Both halves are load-bearing: a meal's figure is one portion of what may be a batch,
              and label/edit/delete have a gesture that nothing else announces. Neither is true of a
              food row, which is why this does not follow the list into the other tab. */}
          {show === 'meals' && (
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              Meal calories are per portion. Swipe a meal for label, edit and delete.
            </p>
          )}
        </>
      )}
    </>
  )
}

/** Wrapper so `FoodRow`'s `onPress` is stable inside the `.map()` above — a hook cannot live in a
 *  map body and an inline arrow defeats `React.memo` silently (Q-490). */
const FoodListRow = memo(function FoodListRow(
  { item, onSelect }: { item: FoodItem; onSelect: (i: FoodItem) => void },
) {
  const press = useCallback(() => onSelect(item), [item, onSelect])
  const secondary = useMemo(() => {
    const serving = item.servingSizeG ? `${Math.round(item.servingSizeG)} g serving` : null
    return [item.brand, serving].filter(Boolean).join(' · ') || null
  }, [item.brand, item.servingSizeG])
  return <FoodRow name={item.name} secondary={secondary} calories={item.calories} onPress={press} />
})
