'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { ChevronLeft, Plus, Minus, Trash2, Search, X, Loader2, CheckSquare, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FoodItem, SavedMeal, MealType, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'
import { cn } from '@trainingai/shared/utils'
import { cancelMealReminder } from '@/lib/meal-reminders'
import { logMealItems } from '@trainingai/shared/nutrition/log-meal'
import { mealTypeForHour } from '@trainingai/shared/nutrition/log-plan-meal'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { invalidateSavedMeals } from '@/lib/cache-groups'
import { TTL_MEDIUM, TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { SavedMealCard } from './saved-meal-card'
import { IngredientRow, type QtyUnit } from './ingredient-row'
import { qtyFromInput, steppedQty } from './saved-meal-qty'
import { IngredientSearch, type ExternalFood } from './ingredient-search'
import type { FoodSearchResponse } from '@/app/api/nutrition/food-search/route'

type SheetTab = 'meals' | 'build'

interface IngredientEntry {
  item: FoodItem
  qty: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogged: (log?: FoodLogWithItem) => void
  userId?: string
  logDate?: string
  // The meal bucket the user opened this sheet from (e.g. "Breakfast"). When set,
  // a quick-logged saved meal goes into THIS bucket, not the current-time-of-day one.
  preselectedMealTypeId?: string
}

export function SavedMealsSheet({ open, onOpenChange, onLogged, userId, logDate, preselectedMealTypeId }: Props) {
  const [tab, setTab] = useState<SheetTab>('meals')
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [mealTypes, setMealTypes] = useState<MealType[]>([])
  const [loading, setLoading] = useState(true)
  const [logging, setLogging] = useState<string | null>(null)
  const [mealQuery, setMealQuery] = useState('')
  // null = not selecting. A Set keeps the bulk actions honest about what they will act on.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  // Seed synchronously from cache so a repeat open paints instantly instead of
  // spinner-flashing while the bare fetches below resolve.
  useLayoutEffect(() => {
    const savedMeals = readCacheSync<SavedMeal[]>('saved-meals')
    const types = readCacheSync<MealType[]>('nutrition-meal-types')
    if (savedMeals) setMeals(Array.isArray(savedMeals) ? savedMeals : [])
    if (types) setMealTypes(Array.isArray(types) ? types : [])
    if (savedMeals || types) setLoading(false)
  }, [])

  // Build tab state
  const [editingMeal, setEditingMeal] = useState<SavedMeal | null>(null)
  const [mealName, setMealName] = useState('')
  const [mealServings, setMealServings] = useState(1)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const [dbResults, setDbResults] = useState<ExternalFood[]>([])
  const [dbSearching, setDbSearching] = useState(false)
  const [dbUnavailable, setDbUnavailable] = useState(false)
  const [addingExternal, setAddingExternal] = useState<string | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [ingredients, setIngredients] = useState<IngredientEntry[]>([])
  const [unitById, setUnitById] = useState<Record<string, QtyUnit>>({})
  const [saving, setSaving] = useState(false)
  const [showAddFood, setShowAddFood] = useState(false)
  const [addFoodForm, setAddFoodForm] = useState({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' })
  const [addFoodSaving, setAddFoodSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('meals')
    fetchMeals()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function fetchMeals() {
    setLoading(true)
    const store = userId ? getLocalStore(userId) : null
    // Local-first: paint the on-device saved meals immediately (works offline).
    if (store) {
      store.getSavedMeals().then(local => { setMeals(local); setLoading(false) }).catch(() => {})
    }
    cachedFetch<MealType[]>('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG,
      d => setMealTypes(Array.isArray(d) ? d : [])).catch(() => {})
    // Revalidate from the server and hydrate the local mirror; on failure/offline the
    // local paint above stands.
    cachedFetch<SavedMeal[]>('saved-meals', '/api/nutrition/saved-meals', TTL_MEDIUM,
      d => {
        const list = Array.isArray(d) ? d : []
        if (store) {
          store.hydrateSavedMeals(list).then(() => store.getSavedMeals()).then(setMeals).catch(() => setMeals(list))
        } else {
          setMeals(list)
        }
      }).finally(() => setLoading(false))
  }

  // Matches the meal name and its ingredients, so "oats" finds a breakfast that contains oats
  // even when the meal is called something else.
  const visibleMeals = mealQuery.trim()
    ? meals.filter(m => {
        const q = mealQuery.trim().toLowerCase()
        return m.name.toLowerCase().includes(q)
          || m.items.some(i => i.foodItem?.name?.toLowerCase().includes(q))
      })
    : meals

  function openBuild(meal?: SavedMeal) {
    setEditingMeal(meal ?? null)
    setMealName(meal?.name ?? '')
    setMealServings(meal?.servings ?? 1)
    setIngredients(meal ? meal.items.map(i => ({ item: i.foodItem, qty: i.quantityMultiplier })) : [])
    setQuery('')
    setSearchResults([])
    setShowAddFood(false)
    setAddFoodForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' })
    setTab('build')
  }

  function backToMeals() {
    setTab('meals')
    setEditingMeal(null)
  }

  useEffect(() => {
    if (!open || tab !== 'build') return
    let cancelled = false
    const t = setTimeout(async () => {
      // Local-first: instant matches from previously-logged foods (works offline).
      const store = userId ? getLocalStore(userId) : null
      if (store) {
        try {
          const local = await store.searchFoodItems(query)
          if (!cancelled) setSearchResults(local)
        } catch {}
      }
      // Revalidate from the server (a superset) when online; keep local on failure/offline.
      try {
        const res = await fetch(`/api/nutrition/food-items?q=${encodeURIComponent(query)}`)
        const d = await res.json()
        if (!cancelled && Array.isArray(d)) setSearchResults(d.slice(0, 20))
      } catch {}
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, tab, userId])

  /**
   * The food database, on its own slower clock.
   *
   * Your own items can only ever return what you have already saved, so the library could never
   * grow past itself; Open Food Facts is the same source the barcode scanner uses. It is a separate
   * effect for two reasons. It must not sit behind the food-items round trip — they are independent
   * queries and chaining them meant a slow library fetch delayed the database section and a stalled
   * one removed it entirely. And OFF rate-limits searches to roughly ten a minute, so typing
   * "chicken breast" at a 250 ms debounce is enough to get 503ed; a longer pause before asking is
   * what keeps the answer coming back at all.
   */
  useEffect(() => {
    if (!open || tab !== 'build') return
    if (query.trim().length < 2) { setDbResults([]); setDbUnavailable(false); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setDbSearching(true)
      try {
        const res = await fetch(`/api/nutrition/food-search?q=${encodeURIComponent(query)}`)
        const d = await res.json() as FoodSearchResponse
        if (!cancelled) {
          setDbResults(Array.isArray(d.results) ? d.results : [])
          setDbUnavailable(!!d.unavailable)
        }
      } catch {
        if (!cancelled) { setDbResults([]); setDbUnavailable(true) }
      } finally {
        if (!cancelled) setDbSearching(false)
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, tab])

  /**
   * An external hit is not a food item yet. Create it, then add it — so it lands in the user's own
   * library and is searchable locally (and offline) from then on.
   */
  async function addExternalFood(food: ExternalFood) {
    setAddingExternal(food.externalId)
    try {
      addIngredient(await createFoodItem({
        name: food.name,
        brand: food.brand,
        servingSizeG: food.servingSizeG,
        calories: food.calories,
        proteinG: food.proteinG ?? 0,
        carbsG: food.carbsG ?? 0,
        fatG: food.fatG ?? 0,
        // Found by searching the food database by name, NOT scanned. A barcode identifies one exact
        // product; a name search returns a plausible near-match the user picked off a list, and the
        // two deserve to be told apart in the data.
        source: 'text',
      }, userId))
    } catch {
      toast.error(offlineHint() ?? `Could not add "${food.name}"`)
    } finally {
      setAddingExternal(null)
    }
  }

  async function estimateAndAdd() {
    const text = query.trim()
    if (!text) return
    setEstimating(true)
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const scan = res.ok ? await res.json() : null
      if (!scan || scan.error || !(scan.calories > 0)) {
        toast.error(`Could not work out the macros for "${text}"`)
        return
      }
      addIngredient(await createFoodItem({
        name: scan.name || text,
        brand: scan.brand,
        servingSizeG: Math.round(scan.servingSizeG ?? 100),
        calories: Math.round(scan.calories),
        proteinG: Math.round((scan.proteinG ?? 0) * 10) / 10,
        carbsG: Math.round((scan.carbsG ?? 0) * 10) / 10,
        fatG: Math.round((scan.fatG ?? 0) * 10) / 10,
        source: 'ai',
      }, userId))
    } catch {
      toast.error(offlineHint() ?? 'Could not add that food')
    } finally {
      setEstimating(false)
    }
  }

  /**
   * A network-only failure, said plainly.
   *
   * Adding a food by hand works offline now (it goes through the outbox), but an Open Food Facts
   * hit and an AI estimate both need the network by nature — so a generic "could not add" while
   * offline reads as a bug rather than a fact about where you are.
   */
  function offlineHint(): string | null {
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'That needs a connection — search your own foods, or add it by hand.'
      : null
  }

  function addIngredient(item: FoodItem) {
    setIngredients(prev => {
      const existing = prev.find(e => e.item.id === item.id)
      if (existing) return prev.map(e => e.item.id === item.id ? { ...e, qty: e.qty + 1 } : e)
      return [...prev, { item, qty: 1 }]
    })
    setQuery('')
    setSearchResults([])
  }

  /**
   * Quantity is entered in servings or in grams, per ingredient, the way MyFitnessPal does it.
   *
   * Servings is the default because that is what "a scoop of whey" means, and the app stores a
   * serving multiplier either way — grams is a second view of the same number, not a second number.
   * An item with no serving size has no gram equivalent, so it only ever offers servings.
   */
  function unitFor(item: FoodItem): QtyUnit {
    return (item.servingSizeG ?? 0) > 0 ? (unitById[item.id] ?? 'serving') : 'serving'
  }

  function setDisplayQty(item: FoodItem, raw: string, unit: QtyUnit) {
    const next = qtyFromInput(raw, unit, item.servingSizeG)
    if (next == null) return
    setIngredients(prev => prev.map(e => e.item.id === item.id ? { ...e, qty: next } : e))
  }

  /** ± moves by half a serving, or by 5 g — whichever unit the row is currently showing. */
  function stepQty(item: FoodItem, unit: QtyUnit, direction: 1 | -1) {
    setIngredients(prev =>
      prev.flatMap(e => {
        if (e.item.id !== item.id) return [e]
        const next = steppedQty(e.qty, unit, direction, item.servingSizeG)
        return next == null ? [] : [{ ...e, qty: next }]
      })
    )
  }

  async function handleAddFoodAndIngredient() {
    const name = addFoodForm.name.trim()
    const calories = parseFloat(addFoodForm.calories)
    if (!name || isNaN(calories)) { toast.error('Name and calories are required'); return }
    setAddFoodSaving(true)
    try {
      addIngredient(await createFoodItem({
        name, calories,
        proteinG: parseFloat(addFoodForm.proteinG) || 0,
        carbsG: parseFloat(addFoodForm.carbsG) || 0,
        fatG: parseFloat(addFoodForm.fatG) || 0,
        servingSizeG: 100,
        source: 'manual',
      }, userId))
      setShowAddFood(false)
      setAddFoodForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' })
      toast.success(`${name} added`)
    } catch {
      toast.error(offlineHint() ?? 'Failed to add food')
    } finally {
      setAddFoodSaving(false)
    }
  }

  const totalMacros = ingredients.reduce(
    (acc, { item, qty }) => ({
      kcal: acc.kcal + (item.calories ?? 0) * qty,
      protein: acc.protein + (item.proteinG ?? 0) * qty,
      carbs: acc.carbs + (item.carbsG ?? 0) * qty,
      fat: acc.fat + (item.fatG ?? 0) * qty,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  )

  async function handleSave() {
    const name = mealName.trim()
    if (!name) { toast.error('Enter a meal name'); return }
    if (ingredients.length === 0) { toast.error('Add at least one ingredient'); return }
    setSaving(true)
    const items = ingredients.map(e => ({ foodItemId: e.item.id, quantityMultiplier: e.qty }))
    const store = userId ? getLocalStore(userId) : null
    const mealId = editingMeal?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    try {
      let savedLocally = false  // Q-216: the local branch owns its own failure, see the catch below
      if (store) {
        try {
        // Local-first: write the meal to the on-device store + queue the outbox mutation,
        // then update the UI synchronously — no waiting on the network (works offline).
        const createdAt = editingMeal
          ? (editingMeal.createdAt instanceof Date ? editingMeal.createdAt.toISOString() : String(editingMeal.createdAt))
          : now
        await store.upsertSavedMeal(
          { id: mealId, name, servings: mealServings, createdAt, updatedAt: now, deletedAt: null, syncStatus: 'pending' },
          items.map(it => ({ id: crypto.randomUUID(), savedMealId: mealId, foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier })),
        )
        await store.queueMutation({ userId: userId!, domain: 'saved_meals', date: todayInTz(), payload: { id: mealId, name, items, servings: mealServings } })
        await invalidateSavedMeals()
        setMeals(await store.getSavedMeals())
        pushMutations(userId!).catch(() => {})
        savedLocally = true
        // Without this the throw reached the outer catch and reported a failed save, never trying
        // the server write in the arm below.
        } catch (e) { console.error('Saved-meal SQLite write failed, falling back to API:', e) }
      }
      if (!savedLocally) {
        // Web fallback (no local store), and the recovery path when the local write above threw.
        const url = editingMeal ? `/api/nutrition/saved-meals/${mealId}` : '/api/nutrition/saved-meals'
        const method = editingMeal ? 'PUT' : 'POST'
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: mealId, name, items, servings: mealServings }),
        })
        if (!res.ok) throw new Error()
        await invalidateSavedMeals()
        fetchMeals()
      }
      toast.success(editingMeal ? `"${name}" updated` : `"${name}" saved to meal library`)
      backToMeals()
    } catch {
      toast.error(editingMeal ? 'Failed to update meal' : 'Failed to save meal')
    } finally {
      setSaving(false)
    }
  }

  async function quickLog(meal: SavedMeal) {
    // Honour the bucket the user opened this sheet from; only fall back to the
    // current time-of-day bucket when the sheet was opened without one (the
    // bottom "Saved Meals" button, which isn't bucket-scoped).
    const mealTypeId = preselectedMealTypeId
      ?? mealTypeForHour(mealTypes, new Date().getHours())
    if (!mealTypeId) { toast.error('No meal type available'); return }
    setLogging(meal.id)
    const targetDate = logDate ?? todayInTz()
    try {
      const logs = await logMealItems(meal, targetDate, mealTypeId, userId)
      toast.success(`${meal.name} logged`)
      for (const log of logs) onLogged(log)
    } catch (err) {
      console.error('Meal log error:', err)
      toast.error('Failed to log meal')
    } finally {
      setLogging(null)
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      if (!prev) return prev
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * Delete everything ticked, then leave selection mode.
   *
   * Sequential rather than Promise.all: each delete queues an outbox mutation, and firing a dozen
   * concurrently against the local store is how the push loop ends up racing itself.
   */
  async function deleteSelected() {
    const ids = [...(selectedIds ?? [])]
    if (ids.length === 0) return
    setBulkDeleting(true)
    let failed = 0
    for (const id of ids) {
      const meal = meals.find(m => m.id === id)
      if (!meal) continue
      try { await deleteMeal(meal, { silent: true }) } catch { failed++ }
    }
    setBulkDeleting(false)
    setConfirmBulkDelete(false)
    setSelectedIds(null)
    if (failed > 0) toast.error(`${failed} of ${ids.length} could not be deleted`)
    else toast.success(`${ids.length} meal${ids.length === 1 ? '' : 's'} deleted`)
  }

  async function deleteMeal(meal: SavedMeal, opts?: { silent?: boolean }) {
    const store = userId ? getLocalStore(userId) : null
    try {
      if (store) {
        // Local-first tombstone + outbox delete; UI updates synchronously (works offline).
        await store.deleteSavedMealLocally(meal.id, new Date().toISOString())
        await store.queueMutation({ userId: userId!, domain: 'saved_meals', date: todayInTz(), payload: { id: meal.id, deleted: true } })
        await invalidateSavedMeals()
        setMeals(prev => prev.filter(m => m.id !== meal.id))
        pushMutations(userId!).catch(() => {})
      } else {
        const res = await fetch(`/api/nutrition/saved-meals/${meal.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        await invalidateSavedMeals()
        setMeals(prev => prev.filter(m => m.id !== meal.id))
      }
      if (!opts?.silent) toast.success('Meal deleted')
    } catch {
      if (opts?.silent) throw new Error('delete failed')
      toast.error('Failed to delete')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col">
        {/* Title alone on the top row so the close ✕ has the corner to itself; the actions get
            their own full-width row below. Squeezing "Select" and "New Meal" in beside the title
            left them jammed against the ✕ and each button too narrow to read comfortably. */}
        <SheetHeader className="px-1 pb-0 shrink-0">
          {tab === 'meals' ? (
            <SheetTitle>
              {selectedIds
                ? `${selectedIds.size} selected`
                : `Saved Meals${meals.length > 0 ? ` · ${meals.length}` : ''}`}
            </SheetTitle>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={backToMeals} aria-label="Back" className="p-2.5 -ml-1.5 text-muted-foreground hover:text-foreground rounded-lg">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <SheetTitle>{editingMeal ? 'Edit Meal' : 'Build a Meal'}</SheetTitle>
            </div>
          )}
        </SheetHeader>

        {tab === 'meals' && (
          <div className="flex shrink-0 gap-2 px-1">
            {selectedIds ? (
              <>
                <Button
                  variant="secondary" className="flex-1 min-h-[44px]"
                  onClick={() => { setSelectedIds(null); setConfirmBulkDelete(false) }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive" className="flex-1 min-h-[44px] gap-1.5"
                  disabled={selectedIds.size === 0 || bulkDeleting}
                  onClick={() => setConfirmBulkDelete(true)}
                >
                  {bulkDeleting
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Trash2 className="w-4 h-4" />}
                  Delete
                </Button>
              </>
            ) : (
              <>
                {meals.length > 1 && (
                  <Button
                    variant="secondary" className="flex-1 min-h-[44px] gap-1.5"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <CheckSquare className="w-4 h-4" />
                    Select
                  </Button>
                )}
                <Button onClick={() => openBuild()} className="flex-1 min-h-[44px] gap-1.5">
                  <Plus className="w-4 h-4" />
                  New Meal
                </Button>
              </>
            )}
          </div>
        )}

        {tab === 'meals' ? (
          <div className="flex-1 overflow-y-auto px-1 space-y-3">
            {confirmBulkDelete && selectedIds && (
              <div className="rounded-xl border border-[#ef4444]/40 bg-[#ef4444]/5 p-3">
                <p className="text-sm font-medium">
                  Delete {selectedIds.size} saved meal{selectedIds.size === 1 ? '' : 's'}?
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  Food you have already logged is unaffected, and any meal plan built from these
                  keeps its own copy.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1 min-h-[44px]" onClick={() => setConfirmBulkDelete(false)} disabled={bulkDeleting}>
                    Cancel
                  </Button>
                  <Button variant="destructive" size="sm" className="flex-1 min-h-[44px]" onClick={() => void deleteSelected()} disabled={bulkDeleting}>
                    {bulkDeleting ? 'Deleting…' : 'Delete them'}
                  </Button>
                </div>
              </div>
            )}
            {/* Search earns its place once the library grows — generated plan meals land here too,
                so this list gets long faster than a hand-built one would. */}
            {meals.length > 4 && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-none" />
                <input
                  value={mealQuery}
                  onChange={e => setMealQuery(e.target.value)}
                  placeholder="Search saved meals"
                  aria-label="Search saved meals"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {mealQuery && (
                  <button onClick={() => setMealQuery('')} aria-label="Clear search" className="p-2 -m-2 text-muted-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : meals.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">No saved meals yet.</p>
                <Button onClick={() => openBuild()}>
                  Build your first meal
                </Button>
              </div>
            ) : visibleMeals.length === 0 ? (
              // meals is non-empty here, so this is a search that matched nothing — say so rather
              // than rendering an empty panel that reads as "your meals vanished".
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-sm text-muted-foreground">No meals match &ldquo;{mealQuery}&rdquo;.</p>
                <Button variant="secondary" size="sm" onClick={() => setMealQuery('')}>Clear search</Button>
              </div>
            ) : (
              visibleMeals.map(meal => (
                <SavedMealCard
                  key={meal.id}
                  meal={meal}
                  logging={logging === meal.id}
                  selected={selectedIds ? selectedIds.has(meal.id) : null}
                  onToggleSelected={() => toggleSelected(meal.id)}
                  onLog={() => quickLog(meal)}
                  onEdit={() => openBuild(meal)}
                  onDelete={() => deleteMeal(meal)}
                />
              ))
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-2">
              {/* Meal name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meal name</label>
                <Input
                  value={mealName}
                  onChange={e => setMealName(e.target.value)}
                  placeholder="e.g. Post-workout shake"
                  className="rounded-xl"
                />
              </div>

              {/* Batch size. A recipe is often not one plate — the ingredients below describe the
                  whole batch, and this is what turns that into a portion. Without it a meal plan
                  put a two-serving tub of ice cream into one slot as if it were one meal. */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  This recipe makes
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMealServings(v => Math.max(1, Math.round((v - 1) * 4) / 4))}
                    aria-label="Fewer servings"
                    className="flex-none w-11 h-11 rounded-lg bg-muted flex items-center justify-center"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step={1}
                    value={mealServings}
                    onChange={e => {
                      const n = parseFloat(e.target.value)
                      if (Number.isFinite(n) && n >= 0.25) setMealServings(Math.min(50, Math.round(n * 4) / 4))
                    }}
                    aria-label="Servings this meal makes"
                    className="min-w-0 flex-1 min-h-[44px] rounded-lg bg-muted px-2 text-sm font-bold tabular-nums text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => setMealServings(v => Math.min(50, Math.round((v + 1) * 4) / 4))}
                    aria-label="More servings"
                    className="flex-none w-11 h-11 rounded-lg bg-muted flex items-center justify-center"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <span className="flex-none text-xs text-muted-foreground">
                    {mealServings === 1 ? 'portion' : 'portions'}
                  </span>
                </div>
                {mealServings !== 1 && (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Enter the ingredients for the <strong>whole batch</strong> below. Logging this
                    meal, and a meal plan using it, takes one portion —{' '}
                    {Math.round(totalMacros.kcal / mealServings)} kcal of the{' '}
                    {Math.round(totalMacros.kcal)} below.
                  </p>
                )}
              </div>

              {/* Ingredient list above search so existing items are visible first */}
              {ingredients.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ingredients</p>
                  {ingredients.map(({ item, qty }) => (
                    <IngredientRow
                      key={item.id}
                      item={item}
                      qty={qty}
                      unit={unitFor(item)}
                      onUnitChange={u => setUnitById(prev => ({ ...prev, [item.id]: u }))}
                      onQtyChange={raw => setDisplayQty(item, raw, unitFor(item))}
                      onStep={dir => stepQty(item, unitFor(item), dir)}
                      onRemove={() => setIngredients(prev => prev.filter(e => e.item.id !== item.id))}
                    />
                  ))}
                  <div className="rounded-xl bg-brand/10 border border-brand/20 px-3 py-2 text-xs font-semibold">
                    {mealServings !== 1 && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Whole batch · {mealServings} portions
                      </p>
                    )}
                    <div className="flex gap-3">
                      <span>{Math.round(totalMacros.kcal)} kcal</span>
                      <span>{Math.round(totalMacros.protein)}g P</span>
                      <span>{Math.round(totalMacros.carbs)}g C</span>
                      <span>{Math.round(totalMacros.fat)}g F</span>
                    </div>
                    {mealServings !== 1 && (
                      <div className="mt-1.5 border-t border-brand/20 pt-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          One portion — what gets logged
                        </p>
                        <div className="mt-0.5 flex gap-3">
                          <span>{Math.round(totalMacros.kcal / mealServings)} kcal</span>
                          <span>{Math.round(totalMacros.protein / mealServings)}g P</span>
                          <span>{Math.round(totalMacros.carbs / mealServings)}g C</span>
                          <span>{Math.round(totalMacros.fat / mealServings)}g F</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <IngredientSearch
                query={query}
                onQueryChange={setQuery}
                searchResults={searchResults}
                onAdd={addIngredient}
                estimating={estimating}
                onEstimate={() => void estimateAndAdd()}
                dbResults={dbResults}
                dbSearching={dbSearching}
                dbUnavailable={dbUnavailable}
                addingExternal={addingExternal}
                onAddExternal={food => void addExternalFood(food)}
                showAddFood={showAddFood}
                onAddByHand={() => { setShowAddFood(true); setAddFoodForm(f => ({ ...f, name: query.trim() })) }}
              />

              {showAddFood && (
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add new food</p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={addFoodForm.name}
                      onChange={e => setAddFoodForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Food name"
                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 ring-brand"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      value={addFoodForm.calories}
                      onChange={e => setAddFoodForm(f => ({ ...f, calories: e.target.value }))}
                      placeholder="Calories per serving *"
                      className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 ring-brand"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      {([['proteinG', 'Protein g'], ['carbsG', 'Carbs g'], ['fatG', 'Fat g']] as [keyof typeof addFoodForm, string][]).map(([field, placeholder]) => (
                        <input
                          key={field}
                          type="number"
                          inputMode="decimal"
                          value={addFoodForm[field]}
                          onChange={e => setAddFoodForm(f => ({ ...f, [field]: e.target.value }))}
                          placeholder={placeholder}
                          className="w-full rounded-xl border bg-background px-2 py-2 text-sm outline-none focus:ring-1 ring-brand"
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowAddFood(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={addFoodSaving || !addFoodForm.name.trim() || !addFoodForm.calories}
                      onClick={handleAddFoodAndIngredient}
                    >
                      {addFoodSaving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                      Add &amp; use
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 pt-2">
              <Button
                className="w-full h-12 font-semibold"
                onClick={handleSave}
                disabled={saving || !mealName.trim() || ingredients.length === 0}
              >
                {saving ? (editingMeal ? 'Updating…' : 'Saving…') : (editingMeal ? 'Update Meal' : 'Save Meal')}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
