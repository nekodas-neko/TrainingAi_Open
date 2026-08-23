'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useSheetBackDismiss } from '@/lib/hooks/use-sheet-back-dismiss'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { FoodRow } from '@/components/nutrition/food-row'

const ALL_ITEMS_KEY = 'nutrition-food-items-all'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (item: FoodItem) => void
  userId?: string
}

export function FoodLibrarySheet({ open, onClose, onSelect, userId }: Props) {
  useSheetBackDismiss(open, onClose)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<FoodItem[]>([])
  const [loading, setLoading] = useState(false)

  useLayoutEffect(() => {
    const seeded = readCacheSync<FoodItem[]>(ALL_ITEMS_KEY)
    if (seeded) setItems(Array.isArray(seeded) ? seeded : [])
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const t = setTimeout(async () => {
      // Local-first: instant matches from previously-logged foods (works offline).
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        try {
          const local = await store.searchFoodItems(query)
          if (!cancelled) setItems(local)
        } catch {}
      }
      // Revalidate from the server (a superset of the local set) when online; on
      // failure/offline we keep the local results already shown.
      if (!query) {
        cachedFetch<FoodItem[]>(ALL_ITEMS_KEY, '/api/nutrition/food-items?q=', TTL_MEDIUM,
          d => { if (!cancelled && Array.isArray(d)) setItems(d) }).catch(() => {})
        return
      }
      setLoading(true)
      try {
        const res = await fetch(`/api/nutrition/food-items?q=${encodeURIComponent(query)}`)
        const d = await res.json()
        if (!cancelled && Array.isArray(d)) setItems(d)
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, userId])

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col p-0">
        <SheetTitle className="sr-only">Food Library</SheetTitle>
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 shrink-0">
          <div className="flex-1 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your food library…"
              className="flex-1 bg-transparent text-sm outline-none"
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2.5 text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              {loading ? 'Searching…' : query ? 'No foods match your search' : 'No foods saved yet — scan or log something first'}
            </p>
          ) : (
            <div className="divide-y divide-border/30">
              {items.map(item => (
                <FoodRowItem key={item.id} item={item} onSelect={onSelect} onClose={onClose} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Wrapper so `FoodRow`'s `onPress` is stable inside the `.map()` above. A hook cannot live in a map
 * body, and an inline arrow at the call site defeats `React.memo` silently — the failure this
 * repo keeps a check for (Q-490). Moving the identity into a child is the sanctioned way out.
 */
const FoodRowItem = memo(function FoodRowItem(
  { item, onSelect, onClose }: { item: FoodItem; onSelect: (i: FoodItem) => void; onClose: () => void },
) {
  const press = useCallback(() => { onSelect(item); onClose() }, [item, onSelect, onClose])
  // Built with useMemo rather than inline: `FoodRow` is memoised and compares shallowly, and an
  // array literal in a prop defeats that even when it collapses to a string (Q-490's check flags it
  // for exactly that reason — the allocation is per-render whatever it resolves to).
  const secondary = useMemo(() => {
    const serving = item.servingSizeG ? `${Math.round(item.servingSizeG)} g serving` : null
    return [item.brand, serving].filter(Boolean).join(' · ') || null
  }, [item.brand, item.servingSizeG])
  return <FoodRow name={item.name} secondary={secondary} calories={item.calories} onPress={press} />
})
