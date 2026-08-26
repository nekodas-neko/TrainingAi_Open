'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
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
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { invalidateSavedMeals } from '@/lib/cache-groups'
import { TTL_MEDIUM, TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { SavedMealCard } from './saved-meal-card'
import { MealDetailSheet } from './meal-detail-sheet'
import { MealPhotoTile } from './meal-photo-tile'
import { usePlanSavedMealIds } from '@/lib/hooks/use-plan-saved-meal-ids'
import { MealLabelSheet } from './meal-label-sheet'
import { BulkDeleteConfirm } from './bulk-delete-confirm'
import { FoodRow } from './food-row'
import { QuantitySheet } from './quantity-sheet'
import { qtyFromInput, steppedQty, type QtyUnit } from './saved-meal-qty'
import { IngredientPicker } from './ingredient-picker'

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
  const planSavedMealIds = usePlanSavedMealIds()
  // Q-413: the eaten-at resolution happens in the USER's zone, not the device's.
  const tz = useUserTimezone()
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
  // Q-389's label preview. Kept here rather than per-card so only one canvas is ever mounted.
  const [labelMeal, setLabelMeal] = useState<SavedMeal | null>(null)
  // BF-30: the meal's own screen, one layer above this list. Held here for the same reason as the
  // label sheet — one mounted instance, not one per row.
  const [detailMeal, setDetailMeal] = useState<SavedMeal | null>(null)
  const [detailConfirmDelete, setDetailConfirmDelete] = useState(false)
  const [mealName, setMealName] = useState('')
  // Always sent explicitly, never omitted. Both write paths treat `undefined` as "leave a stored
  // photo alone" and `null` as "remove it" (Q-396) — and this screen always knows which it means,
  // because `openBuild` seeds it from the meal being edited. Omitting instead would be the same
  // save with one more state to get wrong.
  const [mealImage, setMealImage] = useState<string | null>(null)
  const [mealServings, setMealServings] = useState(1)
  const [ingredients, setIngredients] = useState<IngredientEntry[]>([])
  const [unitById, setUnitById] = useState<Record<string, QtyUnit>>({})
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Bumped on every entry to the build form. `IngredientPicker` owns the search query, its results
  // and the add-by-hand form (BF-11a), so remounting it on a new build session is what clears them —
  // which is what the setters that used to sit in `openBuild` did.
  const [buildSession, setBuildSession] = useState(0)

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

  // Q-357: `useCallback` on the five handlers the card takes, so `SavedMealCard`'s `memo()` is not
  // defeated by a fresh identity every render. `openBuild` and `toggleSelected` touch only state
  // setters, so `[]` is stable by React's guarantee rather than by hope.
  const openBuild = useCallback((meal?: SavedMeal) => {
    setEditingMeal(meal ?? null)
    setMealName(meal?.name ?? '')
    setMealImage(meal?.imageDataUri ?? null)
    setMealServings(meal?.servings ?? 1)
    setIngredients(meal ? meal.items.map(i => ({ item: i.foodItem, qty: i.quantityMultiplier })) : [])
    setEditingIngredientId(null)
    setBuildSession(n => n + 1)
    setTab('build')
  }, [])

  function backToMeals() {
    setTab('meals')
    setEditingMeal(null)
  }

  function addIngredient(item: FoodItem) {
    setIngredients(prev => {
      const existing = prev.find(e => e.item.id === item.id)
      if (existing) return prev.map(e => e.item.id === item.id ? { ...e, qty: e.qty + 1 } : e)
      return [...prev, { item, qty: 1 }]
    })
  }

  /**
   * Quantity is entered in servings or in grams, per ingredient, the way MyFitnessPal does it.
   *
   * Servings is the default because that is what "a scoop of whey" means, and the app stores a
   * serving multiplier either way — grams is a second view of the same number, not a second number.
   * An item with no serving size has no gram equivalent, so it only ever offers servings.
   */
  /** The collapsed row's grey line — *how much*, in whichever unit this ingredient is set to. */
  function amountLabel(item: FoodItem, qty: number, unit: QtyUnit): string {
    const servingG = item.servingSizeG ?? 0
    if (unit === 'g' && servingG > 0) return `${Math.round(servingG * qty)} g`
    const servings = Math.round(qty * 100) / 100
    const label = `${servings} ${servings === 1 ? 'serving' : 'servings'}`
    return servingG > 0 ? `${label} · ${Math.round(servingG * qty)} g` : label
  }

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

  const editingIndex = ingredients.findIndex(e => e.item.id === editingIngredientId)
  // `stepQty` removes a row when a step takes it to zero, so the sheet can outlive its ingredient.
  const editingEntry = editingIndex === -1 ? null : ingredients[editingIndex]

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
          { id: mealId, name, servings: mealServings, imageDataUri: mealImage, createdAt, updatedAt: now, deletedAt: null, syncStatus: 'pending' },
          items.map(it => ({ id: crypto.randomUUID(), savedMealId: mealId, foodItemId: it.foodItemId, quantityMultiplier: it.quantityMultiplier })),
        )
        // BF-11e added `mealTypeIds` to the route, the outbox branch and the local table. This
        // payload deliberately does NOT send it yet, and that is the correct no-op rather than an
        // omission: absent means "leave the stored tags alone" on both the local upsert above and
        // the server replay, while sending the currently-loaded tags would REVERT a change made on
        // another device between this sheet loading and this save. There is no asymmetry for the
        // sync rule to catch either — no surface can set a tag today, web or native.
        // **BF-11f adds the picker: it must add `mealTypeIds` HERE and to `upsertSavedMeal` above,
        // in the same PR**, or tags will save on the web and strand offline.
        await store.queueMutation({ userId: userId!, domain: 'saved_meals', date: todayInTz(tz), payload: { id: mealId, name, items, servings: mealServings, imageDataUri: mealImage } })
        await invalidateSavedMeals()
        setMeals(await store.getSavedMeals())
        pushThenRevalidate(userId!, invalidateSavedMeals)
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
          body: JSON.stringify({ id: mealId, name, items, servings: mealServings, imageDataUri: mealImage }),
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

  const quickLog = useCallback(async (meal: SavedMeal) => {
    // Honour the bucket the user opened this sheet from; only fall back to the
    // current time-of-day bucket when the sheet was opened without one (the
    // bottom "Saved Meals" button, which isn't bucket-scoped).
    const mealTypeId = preselectedMealTypeId
      ?? mealTypeForHour(mealTypes, new Date().getHours())
    if (!mealTypeId) { toast.error('No meal type available'); return }
    setLogging(meal.id)
    const targetDate = logDate ?? todayInTz(tz)
    try {
      const logs = await logMealItems(meal, targetDate, mealTypeId, userId, tz)
      toast.success(`${meal.name} logged`)
      for (const log of logs) onLogged(log)
    } catch (err) {
      console.error('Meal log error:', err)
      toast.error('Failed to log meal')
    } finally {
      setLogging(null)
    }
  }, [preselectedMealTypeId, mealTypes, logDate, userId, tz, onLogged])

  const openDetail = useCallback((meal: SavedMeal) => {
    setDetailConfirmDelete(false)
    setDetailMeal(meal)
  }, [])

  /** The swipe tray's Delete lands on the meal with its confirmation already up. */
  const requestDelete = useCallback((meal: SavedMeal) => {
    setDetailMeal(meal)
    setDetailConfirmDelete(true)
  }, [])

  const toggleSelected = useCallback((meal: SavedMeal) => {
    setSelectedIds(prev => {
      if (!prev) return prev
      const next = new Set(prev)
      if (next.has(meal.id)) next.delete(meal.id)
      else next.add(meal.id)
      return next
    })
  }, [])

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

  const deleteMeal = useCallback(async (meal: SavedMeal, opts?: { silent?: boolean }) => {
    const store = userId ? getLocalStore(userId) : null
    try {
      if (store) {
        // Local-first tombstone + outbox delete; UI updates synchronously (works offline).
        await store.deleteSavedMealLocally(meal.id, new Date().toISOString())
        await store.queueMutation({ userId: userId!, domain: 'saved_meals', date: todayInTz(tz), payload: { id: meal.id, deleted: true } })
        await invalidateSavedMeals()
        setMeals(prev => prev.filter(m => m.id !== meal.id))
        pushThenRevalidate(userId!, invalidateSavedMeals)
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
  }, [userId, tz])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col">
        {/* Title alone on the top row so the close ✕ has the corner to itself; the actions get
            their own full-width row below. Squeezing "Select" and "New Meal" in beside the title
            left them jammed against the ✕ and each button too narrow to read comfortably. */}
        <SheetHeader className="px-1 pb-0 shrink-0">
          {tab === 'meals' ? (
            <SheetTitle>
              {selectedIds ? `${selectedIds.size} selected` : 'Saved Meals'}
            </SheetTitle>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={backToMeals} aria-label="Back" className="p-2.5 -ml-1.5 text-muted-foreground hover:text-foreground rounded-lg">
                <ChevronLeft className="w-5 h-5" />
              </button>
              {/* Q-395a: the meal's name is the screen title once it has one, and the batch
                  explainer is its subtitle — "Edit Meal" said nothing the screen did not already
                  show, and the batch figure was buried below the fold. */}
              <div className="min-w-0">
                <SheetTitle className="truncate">
                  {mealName.trim() || (editingMeal ? 'Edit Meal' : 'Build a Meal')}
                </SheetTitle>
                {ingredients.length > 0 && (
                  <p className="truncate text-xs tabular-nums text-muted-foreground">
                    Makes {mealServings} {mealServings === 1 ? 'portion' : 'portions'} ·{' '}
                    {Math.round(totalMacros.kcal / mealServings)} kcal each
                  </p>
                )}
              </div>
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
                {/* Artboard 3 puts a single `+ New` pill in the header band, not a pair of
                    full-width bars. It cannot literally sit beside the title here — the sheet's
                    close ✕ is `absolute top-4 right-4` and owns that corner — so the pills keep
                    their own row and take the drawing's weight instead of its position. */}
                <span className="flex-1" />
                {meals.length > 1 && (
                  <Button
                    variant="secondary" size="sm" className="min-h-[44px] rounded-full px-4 gap-1.5"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <CheckSquare className="w-4 h-4" />
                    Select
                  </Button>
                )}
                <Button onClick={() => openBuild()} size="sm" className="min-h-[44px] rounded-full px-4 gap-1.5">
                  <Plus className="w-4 h-4" />
                  New
                </Button>
              </>
            )}
          </div>
        )}

        {tab === 'meals' ? (
          <div className="flex-1 overflow-y-auto px-1 space-y-3">
            {confirmBulkDelete && selectedIds && (
              <BulkDeleteConfirm
                count={selectedIds.size}
                deleting={bulkDeleting}
                onCancel={() => setConfirmBulkDelete(false)}
                onConfirm={() => void deleteSelected()}
              />
            )}
            {/* Search earns its place once the library grows — generated plan meals land here too,
                so this list gets long faster than a hand-built one would. Artboard 3 draws it over
                a three-meal list, so the old "more than four" gate is gone: a search box that
                appears partway down a growing library is a control you have to notice twice. */}
            {meals.length > 0 && (
              <div className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-none" />
                <input
                  value={mealQuery}
                  onChange={e => setMealQuery(e.target.value)}
                  placeholder="Search your meals"
                  aria-label="Search your meals"
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
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  {visibleMeals.length} meal{visibleMeals.length === 1 ? '' : 's'}
                </p>
                {/* One grouped card, not a stack of them (artboard 3). Separate cards gave every
                    meal its own border and the list stopped reading as a list. */}
                <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border">
                  {visibleMeals.map(meal => (
                    <SavedMealCard
                      key={meal.id}
                      meal={meal}
                      selected={selectedIds ? selectedIds.has(meal.id) : null}
                      onToggleSelected={toggleSelected}
                      onOpen={openDetail}
                      onEdit={openBuild}
                      onRequestDelete={requestDelete}
                      onLabel={setLabelMeal}
                      fromPlan={planSavedMealIds.has(meal.id)}
                    />
                  ))}
                </div>
                {/* Both halves are load-bearing: the figure on a row is one portion of what may be
                    a batch, and label/edit/delete now have a gesture that nothing else announces. */}
                <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
                  Calories are per portion. Swipe a row for label, edit and delete.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-2">
              {/* Meal name, with the photo beside it. The tile is the picker AND the preview, so
                  there is no separate "current photo" row, and the picture rides the save that is
                  already here rather than needing a write of its own (Q-327). */}
              <div className="flex items-start gap-3">
                <MealPhotoTile value={mealImage} onChange={setMealImage} disabled={saving} />
                <div className="min-w-0 flex-1 space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meal name</label>
                  <Input
                    value={mealName}
                    onChange={e => setMealName(e.target.value)}
                    placeholder="e.g. Post-workout shake"
                    className="rounded-xl"
                  />
                </div>
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
                    className="flex-none w-12 h-12 rounded-lg bg-muted flex items-center justify-center"
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
                    className="min-w-0 flex-1 min-h-12 rounded-lg bg-muted px-2 text-sm font-bold tabular-nums text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => setMealServings(v => Math.min(50, Math.round((v + 1) * 4) / 4))}
                    aria-label="More servings"
                    className="flex-none w-12 h-12 rounded-lg bg-muted flex items-center justify-center"
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
                  {/* Q-395a finding 12: the row carries no editor. It is the same `FoodRow` the
                      diary and both search lists draw, and the quantity control lives in the sheet
                      a tap opens — which is the only reason one row component can serve all four. */}
                  <div className="overflow-hidden rounded-xl bg-muted/40 divide-y divide-border/40">
                    {ingredients.map(({ item, qty }) => (
                      <IngredientListRow
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        secondary={amountLabel(item, qty, unitFor(item))}
                        calories={(item.calories ?? 0) * qty}
                        highlighted={item.id === editingIngredientId}
                        onEdit={setEditingIngredientId}
                      />
                    ))}
                  </div>
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

              <IngredientPicker
                key={buildSession}
                active={open && tab === 'build'}
                userId={userId}
                onAdd={addIngredient}
              />

              <QuantitySheet
                item={editingEntry?.item ?? null}
                qty={editingEntry?.qty ?? 1}
                unit={editingEntry ? unitFor(editingEntry.item) : 'serving'}
                index={editingIndex + 1}
                total={ingredients.length}
                mealName={mealName.trim()}
                onUnitChange={u => editingEntry && setUnitById(prev => ({ ...prev, [editingEntry.item.id]: u }))}
                onQtyChange={raw => editingEntry && setDisplayQty(editingEntry.item, raw, unitFor(editingEntry.item))}
                onStep={dir => editingEntry && stepQty(editingEntry.item, unitFor(editingEntry.item), dir)}
                onRemove={() => {
                  if (!editingEntry) return
                  const id = editingEntry.item.id
                  setEditingIngredientId(null)
                  setIngredients(prev => prev.filter(e => e.item.id !== id))
                }}
                onClose={() => setEditingIngredientId(null)}
              />
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
      {/* Stacked over the list, not replacing it — `back-dismiss.tsx` closes one layer per press,
          and a route would have to dismiss this sheet to navigate and re-open it on the way back. */}
      <MealDetailSheet
        meal={detailMeal}
        logging={detailMeal ? logging === detailMeal.id : false}
        confirmingDelete={detailConfirmDelete}
        onConfirmingDeleteChange={setDetailConfirmDelete}
        onOpenChange={o => { if (!o) { setDetailMeal(null); setDetailConfirmDelete(false) } }}
        onLog={async m => { await quickLog(m); setDetailMeal(null) }}
        onEdit={m => { setDetailMeal(null); openBuild(m) }}
        onDelete={async m => { await deleteMeal(m); setDetailMeal(null) }}
        onLabel={m => setLabelMeal(m)}
      />
      <MealLabelSheet
        meal={labelMeal}
        open={labelMeal != null}
        onOpenChange={o => { if (!o) setLabelMeal(null) }}
      />
    </Sheet>
  )
}

/** Wrapper so the memoised row gets a stable `onPress` from inside a `.map()`, where a hook cannot
 *  live and an inline arrow would defeat `React.memo` silently (Q-490). Props are scalars for the
 *  same reason — an object literal would defeat it just as quietly. */
const IngredientListRow = memo(function IngredientListRow(
  { id, name, secondary, calories, highlighted, onEdit }:
  { id: string; name: string; secondary: string; calories: number; highlighted: boolean; onEdit: (id: string) => void },
) {
  const press = useCallback(() => onEdit(id), [id, onEdit])
  return <FoodRow name={name} secondary={secondary} calories={calories} showChevron highlighted={highlighted} onPress={press} />
})
