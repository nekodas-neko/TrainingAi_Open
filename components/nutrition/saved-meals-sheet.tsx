'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { Plus, Camera } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { FoodItem, SavedMeal, MealType, FoodLogWithItem, NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'
import { logMealItems } from '@trainingai/shared/nutrition/log-meal'
import { mealTypeForHour } from '@trainingai/shared/nutrition/log-plan-meal'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { invalidateSavedMeals } from '@/lib/cache-groups'
import { TTL_MEDIUM, TTL_LONG } from '@trainingai/shared/cache-ttl'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { FoodList } from './food-list'
import { CaptureActions } from './capture-actions'
import { MealListActions } from './meal-list-actions'
import { RecentFoodsPanel } from './recent-foods-panel'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { MealDetailSheet } from './meal-detail-sheet'
import { MealPhotoTile } from './meal-photo-tile'
import { usePlanSavedMealIds } from '@/lib/hooks/use-plan-saved-meal-ids'
import { MealLabelSheet } from './meal-label-sheet'
import { BulkDeleteConfirm } from './bulk-delete-confirm'
import { FoodRow } from './food-row'
import { QuantitySheet } from './quantity-sheet'
import { useIngredientQuantities } from './use-ingredient-quantities'
import { ingredientAmountLabel } from './saved-meal-qty'
import { MealTypeTags } from './meal-type-tags'
import { IngredientPicker } from './ingredient-picker'
import { MealBatchSize } from './meal-batch-size'
import { MealBuilderFooter } from './meal-builder-footer'
import { MealBuilderHeader } from './meal-builder-header'
import { recipeBuilderPatch } from './recipe-import'
import { findDuplicateMeal, type ComparableMeal } from './meal-duplicate'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import { saveMealToLibrary } from './save-meal'
import { DuplicateMealPrompt } from './duplicate-meal-prompt'
import { RecipeCandidates, type RecipeCandidate } from './recipe-candidates'
import { savePlanMealToLibrary } from '@trainingai/shared/nutrition/save-plan-meal'

/** Which SCREEN is showing. The tab strip within the list screen is `listTab` below. */
type SheetTab = 'meals' | 'build'

/**
 * The tabs of the list screen (LB-16, then BF-37).
 *
 * **Three, not the two LB-16 decided.** That decision was made while saved meals and single foods
 * were one list; the owner's report that they are *"2 seperate things"* un-merges them, and the
 * strip is where that split lands — two tabs side by side make the difference visible in a way two
 * separately-reached sheets never did. `Frequent` is still cut: it was a second ordering of
 * `Recent`.
 *
 * **The tab labels drop the possessive deliberately.** `My Foods` against `My Meals` is the pair the
 * owner could not tell apart, and two labels that differ only in their last word are hard to tell
 * apart wherever they appear. `Meals` against `Single foods` names the actual distinction — a
 * composition against one thing. (`My Meals` survives on the page's own button, where it names one
 * list rather than one of two lookalikes.)
 */
const LIST_TABS = [
  { value: 'recent' as const, label: 'Recent' },
  { value: 'meals' as const, label: 'Meals' },
  { value: 'foods' as const, label: 'Single foods' },
]
type ListTab = (typeof LIST_TABS)[number]['value']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogged: (log?: FoodLogWithItem) => void
  userId?: string
  logDate?: string
  // The meal bucket the user opened this sheet from (e.g. "Breakfast"). When set,
  // a quick-logged saved meal goes into THIS bucket, not the current-time-of-day one.
  preselectedMealTypeId?: string
  /**
   * Opens the assign step for a plain food — pick a meal type, pick a quantity. That step lives in
   * `FoodLoggerSheet`, so this sheet cannot supply it and the list cannot draw a food row without
   * it (Q-395c).
   */
  onSelectFood: (item: FoodItem) => void
  /** A scan came back — the parent pushes its review step. */
  onScanResult: (result: NutritionScanResult) => void
  /** Straight to the manual form, skipping the scan. */
  onManual: () => void
  /** A scanned saved-meal label (Q-389); the parent owns the logging. */
  onScannedSavedMeal?: (mealId: string) => void
  /** Open on `Meals` rather than `Recent` — set when the entry point was the page's My Meals button. */
  openOnMeals?: boolean
}

export function SavedMealsSheet({ open, onOpenChange, onLogged, userId, logDate, preselectedMealTypeId, onSelectFood, onScanResult, onManual, onScannedSavedMeal, openOnMeals }: Props) {
  const planSavedMealIds = usePlanSavedMealIds()
  // Q-413: the eaten-at resolution happens in the USER's zone, not the device's.
  const tz = useUserTimezone()
  const [tab, setTab] = useState<SheetTab>('meals')
  const [listTab, setListTab] = useState<ListTab>('recent')
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
  const {
    ingredients, setIngredients, addIngredient, removeIngredient,
    unitFor, setUnit, setDisplayQty, stepQty,
  } = useIngredientQuantities()
  // Which meal slots a plan may use this meal in (BF-11f). Empty = every slot, which is what
  // `mealFitsSlot` already means by an untagged meal — never "no slot".
  const [mealTypeIds, setMealTypeIds] = useState<string[]>([])
  const [editingIngredientId, setEditingIngredientId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Bumped on every entry to the build form. `IngredientPicker` owns the search query, its results
  // and the add-by-hand form (BF-11a), so remounting it on a new build session is what clears them —
  // which is what the setters that used to sit in `openBuild` did.
  const [buildSession, setBuildSession] = useState(0)
  const [renamingMeal, setRenamingMeal] = useState(false)
  // The picker starts open for a NEW meal — an empty builder with a collapsed search is a dead end —
  // and closed when editing one, which is the state artboard 5 draws.
  const [pickerOpen, setPickerOpen] = useState(true)
  // An imported recipe whose page never stated a yield: the figures below are the whole batch until
  // the user says otherwise, and nothing else on screen would reveal that.
  const [unstatedYield, setUnstatedYield] = useState(false)
  // A recipe page that held several dishes (BF-11c). Non-null replaces the build form with the
  // picker: the choice is which dishes to save, not what to put in the meal on screen.
  const [candidates, setCandidates] = useState<RecipeCandidate[] | null>(null)
  const [savingCandidates, setSavingCandidates] = useState(false)
  // BF-11d: the meal this one looks like, once a save has found one. Non-null puts the question on
  // screen; `duplicateAnswered` is what stops it being asked again on the way through its own answer.
  const [duplicateOf, setDuplicateOf] = useState<ComparableMeal | null>(null)
  const [duplicateAnswered, setDuplicateAnswered] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('meals')
    setListTab(openOnMeals ? 'meals' : 'recent')
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

  // Q-357: `useCallback` on the five handlers the card takes, so `SavedMealCard`'s `memo()` is not
  // defeated by a fresh identity every render. `openBuild` and `toggleSelected` touch only state
  // setters, so the deps are stable by React's guarantee rather than by hope — `setIngredients` is
  // listed only because it now reaches here through a hook, where the linter cannot see that.
  const openBuild = useCallback((meal?: SavedMeal) => {
    setEditingMeal(meal ?? null)
    setMealName(meal?.name ?? '')
    setMealImage(meal?.imageDataUri ?? null)
    setMealServings(meal?.servings ?? 1)
    setMealTypeIds(meal?.mealTypeIds ?? [])
    setIngredients(meal ? meal.items.map(i => ({ item: i.foodItem, qty: i.quantityMultiplier })) : [])
    setEditingIngredientId(null)
    setBuildSession(n => n + 1)
    setRenamingMeal(!meal)
    setPickerOpen(!meal || meal.items.length === 0)
    setUnstatedYield(false)
    setCandidates(null)
    setDuplicateOf(null)
    setDuplicateAnswered(false)
    setTab('build')
  }, [setIngredients])

  /**
   * Selection mode belongs to the meal list, and only that list draws its Cancel/Delete row — so
   * leaving the tab with a selection live strands the header on "3 selected" with no way to clear
   * it. Dropping the selection on the way out is the only exit that cannot get stuck.
   */
  function changeListTab(next: ListTab) {
    if (next !== 'meals') { setSelectedIds(null); setConfirmBulkDelete(false) }
    setListTab(next)
  }

  function backToMeals() {
    setTab('meals')
    setEditingMeal(null)
  }


  /**
   * A recipe pasted as a link becomes this meal (BF-11c).
   *
   * It fills fields the builder already has rather than inventing a mode. The numeric decision —
   * what `servings` becomes, and when to prompt — is `recipeBuilderPatch`, which is a pure function
   * with tests because getting it wrong logs a twelfth of a slice and looks plausible.
   */
  function importRecipe(recipe: { name: string; entries: { item: FoodItem; qty: number }[]; recipeYield: number | null }) {
    setIngredients(prev => {
      const next = [...prev]
      for (const { item, qty } of recipe.entries) {
        const at = next.findIndex(e => e.item.id === item.id)
        if (at === -1) next.push({ item, qty })
        else next[at] = { ...next[at], qty: next[at].qty + qty }
      }
      return next
    })
    // Read from the closure, not inside a `setMealName` updater: an updater must be pure, and React
    // may call it twice under StrictMode. This runs from a press, so the current render's name is
    // the right one.
    const patch = recipeBuilderPatch(recipe, mealName)
    setMealName(patch.name)
    setMealServings(patch.servings)
    setUnstatedYield(patch.unstatedYield)
    setRenamingMeal(false)
  }

  /**
   * Every dish the user kept from a multi-recipe page becomes its own saved meal (BF-11c §5.2).
   *
   * `savePlanMealToLibrary` is reused rather than re-implemented: its contract is exactly
   * `{ name, ingredients }`, and it already mints the food items through `ingredientToEntry`, writes
   * the meal local-first, queues the outbox mutation and invalidates. Its `servings: 1` is right
   * here for the same reason it is right for an import — `/api/nutrition/scan` has already divided
   * by any stated yield, so each candidate arrives as one serving.
   *
   * Serial, matching that function's own reasoning: each meal writes several rows to the same local
   * tables and queues its own mutations, and four of them is not worth racing.
   */
  async function keepCandidates(kept: RecipeCandidate[]) {
    setSavingCandidates(true)
    let failed = 0
    for (const c of kept) {
      try {
        await savePlanMealToLibrary({ name: c.name, ingredients: c.ingredients }, userId)
      } catch {
        failed++
      }
    }
    setSavingCandidates(false)
    setCandidates(null)
    const saved = kept.length - failed
    if (saved > 0) toast.success(saved === 1 ? `"${kept[0].name}" saved` : `${saved} meals saved`)
    // Reported separately rather than folded in: a partial save is exactly when the user needs to
    // know which half happened.
    if (failed > 0) toast.error(failed === 1 ? 'One dish could not be saved' : `${failed} dishes could not be saved`)
    if (saved > 0) { await invalidateSavedMeals(); backToMeals(); fetchMeals() }
  }

  // `[]` is stable by React's guarantee — a setter, not a value. Hoisted rather than inline because
  // `MealBatchSize` is memoised and one inline arrow would defeat it silently (Q-490).
  const clearUnstatedYield = useCallback(() => setUnstatedYield(false), [])

  const toggleMealType = useCallback((id: string) => {
    setMealTypeIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }, [])

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

  /** The same figures in `MacroTotals` shape, which is what duplicate detection compares (BF-11d). */
  /**
   * Which imported dishes you already have (BF-11d), by index.
   *
   * Computed here rather than in the picker because the library lives here — and computed once for
   * the whole list rather than per row, so a four-dish page is four lookups, not four per render.
   */
  const candidateDuplicates = useMemo(
    () => (candidates ?? []).map(c =>
      findDuplicateMeal({ name: c.name, totals: sumIngredients(c.ingredients) }, meals)?.name ?? null),
    [candidates, meals],
  )

  const candidateTotals = {
    calories: totalMacros.kcal,
    proteinG: totalMacros.protein,
    carbsG: totalMacros.carbs,
    fatG: totalMacros.fat,
  }

  /**
   * Save, unless it looks like something you already have (BF-11d).
   *
   * `overwrite` is the meal the user chose to update. Its **id is kept**, which is the whole reason
   * this is not a delete-and-recreate: `meal_plan_meals.saved_meal_id` references it, and so does a
   * printed QR label the owner may already have stuck on a container.
   */
  async function handleSave(overwrite?: ComparableMeal) {
    const name = mealName.trim()
    if (!name) { toast.error('Enter a meal name'); return }
    if (ingredients.length === 0) { toast.error('Add at least one ingredient'); return }

    // Runs on save, never per keystroke — and never when the user has already answered, or the
    // question would come back on the way through its own answer.
    if (!overwrite && !duplicateAnswered) {
      const match = findDuplicateMeal({ name, totals: candidateTotals }, meals, editingMeal?.id)
      if (match) { setDuplicateOf(match); return }
    }

    setSaving(true)
    // Keeps the meal's own creation date when re-saving over one, whether it was opened for editing
    // or matched as a duplicate: it is the same meal either way.
    const target = editingMeal ?? (overwrite ? meals.find(m => m.id === overwrite.id) ?? null : null)
    const mealId = target?.id ?? crypto.randomUUID()
    try {
      const fresh = await saveMealToLibrary({
        mealId,
        name,
        items: ingredients.map(e => ({ foodItemId: e.item.id, quantityMultiplier: e.qty })),
        servings: mealServings,
        imageDataUri: mealImage,
        // `overwrite` is always a meal OTHER than the one on screen — duplicate detection excludes
        // `editingMeal` — so the builder never loaded or showed its tags, and sending the builder's
        // (empty, for a new meal) would wipe them. Undefined leaves them alone, which is the only
        // honest answer to a question the user was never asked.
        mealTypeIds: overwrite ? undefined : mealTypeIds,
        createdAt: target
          ? (target.createdAt instanceof Date ? target.createdAt.toISOString() : String(target.createdAt))
          : new Date().toISOString(),
        isUpdate: target != null,
        userId,
        tz,
      })
      if (fresh) setMeals(fresh)
      else fetchMeals()
      toast.success(target ? `"${name}" updated` : `"${name}" saved to meal library`)
      backToMeals()
    } catch {
      toast.error(target ? 'Failed to update meal' : 'Failed to save meal')
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

  /**
   * Which bucket `Recent` reads. Pinned for the life of the sheet rather than recomputed per render:
   * the hour ticking over mid-session is not a reason to swap the list under a thumb, and a value
   * that changes every render would be an unstable prop.
   */
  const recentMealTypeId = useMemo(
    () => preselectedMealTypeId ?? mealTypeForHour(mealTypes, new Date().getHours()) ?? null,
    [preselectedMealTypeId, mealTypes],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col">
        {/* Title alone on the top row so the close ✕ has the corner to itself; the actions get
            their own full-width row below. Squeezing "Select" and "New Meal" in beside the title
            left them jammed against the ✕ and each button too narrow to read comfortably. */}
        <SheetHeader className="px-4 pb-0 shrink-0">
          {tab === 'meals' ? (
            <SheetTitle>
              {selectedIds ? `${selectedIds.size} to delete` : 'Log Food'}
            </SheetTitle>
          ) : (
            <MealBuilderHeader
              onBack={backToMeals}
              name={mealName}
              onNameChange={setMealName}
              renaming={renamingMeal}
              onRenamingChange={setRenamingMeal}
              editing={editingMeal != null}
              hasIngredients={ingredients.length > 0}
              servings={mealServings}
              batchKcal={totalMacros.kcal}
            />
          )}
        </SheetHeader>

        {tab === 'meals' ? (
          // LB-16: this IS the Log Food screen now, not a list stacked on one. `CaptureActions`
          // renders these children while idle and takes the whole screen once a capture starts, so
          // the tabs cannot be left showing behind a half-open camera.
          <CaptureActions onScanResult={onScanResult} onManual={onManual} onScannedSavedMeal={onScannedSavedMeal}>
            <SegmentedTabs tabs={LIST_TABS} value={listTab} onValueChange={changeListTab} size="xs" className="shrink-0 px-4" />
            {listTab === 'meals' && (
              <MealListActions
                selectedCount={selectedIds ? selectedIds.size : null}
                canSelect={meals.length > 1}
                deleting={bulkDeleting}
                onStartSelecting={() => setSelectedIds(new Set())}
                onCancelSelecting={() => { setSelectedIds(null); setConfirmBulkDelete(false) }}
                onConfirmDelete={() => setConfirmBulkDelete(true)}
                onNew={() => openBuild()}
              />
            )}
            <div className="flex-1 overflow-y-auto px-4 space-y-3">
              {confirmBulkDelete && selectedIds && (
                <BulkDeleteConfirm
                  count={selectedIds.size}
                  deleting={bulkDeleting}
                  onCancel={() => setConfirmBulkDelete(false)}
                  onConfirm={() => void deleteSelected()}
                />
              )}
              {listTab === 'recent' ? (
                <RecentFoodsPanel mealTypeId={recentMealTypeId} userId={userId} onSelectFood={onSelectFood} />
              ) : (
                <FoodList
                  show={listTab}
                  meals={meals}
                  loadingMeals={loading}
                  query={mealQuery}
                  onQueryChange={setMealQuery}
                  selectedIds={selectedIds}
                  onToggleSelected={toggleSelected}
                  onOpenMeal={openDetail}
                  onEditMeal={openBuild}
                  onRequestDeleteMeal={requestDelete}
                  onLabelMeal={setLabelMeal}
                  planSavedMealIds={planSavedMealIds}
                  onBuildFirst={openBuild}
                  onSelectFood={onSelectFood}
                  userId={userId}
                />
              )}
            </div>
          </CaptureActions>
        ) : (
          <>
            {candidates ? (
              // Replaces the body AND the footer: while this is up the choice is which dishes to
              // save, so the build form's own Save button would be answering a different question.
              <div className="flex-1 overflow-y-auto px-4 pb-2">
                <RecipeCandidates
                  candidates={candidates}
                  duplicateNames={candidateDuplicates}
                  saving={savingCandidates}
                  onCancel={() => setCandidates(null)}
                  onKeep={kept => void keepCandidates(kept)}
                />
              </div>
            ) : (
            <>
            <div className="flex-1 overflow-y-auto px-4 space-y-4 pb-2">
              <MealBatchSize
                servings={mealServings}
                onChange={setMealServings}
                unstatedYield={unstatedYield}
                onYieldAnswered={clearUnstatedYield}
                batchKcal={totalMacros.kcal}
              />

              <MealTypeTags
                mealTypes={mealTypes}
                selected={mealTypeIds}
                onToggle={toggleMealType}
              />

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
                        secondary={ingredientAmountLabel(item.servingSizeG, qty)}
                        calories={(item.calories ?? 0) * qty}
                        highlighted={item.id === editingIngredientId}
                        onEdit={setEditingIngredientId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Artboard 5 ends the list with two affordances rather than a permanently-open search
                  and a tile at the top. The picker still expands in place — a sheet on top of a
                  sheet to add one ingredient would be a third layer over the library. */}
              {pickerOpen ? (
                <IngredientPicker
                  key={buildSession}
                  active={open && tab === 'build'}
                  userId={userId}
                  onAdd={addIngredient}
                  onImportRecipe={importRecipe}
                  onRecipeCandidates={setCandidates}
                />
              ) : (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-muted-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Add ingredient
                </button>
              )}

              {/* The tile is the picker AND the preview, so there is no separate "current photo"
                  row, and the picture rides the save that is already here rather than needing a
                  write of its own (Q-327). */}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <MealPhotoTile value={mealImage} onChange={setMealImage} disabled={saving} />
                <span className="inline-flex items-center gap-1.5">
                  <Camera className="h-4 w-4" />
                  {mealImage ? 'Change the photo' : 'Add a photo'}
                </span>
              </div>

              <QuantitySheet
                item={editingEntry?.item ?? null}
                qty={editingEntry?.qty ?? 1}
                unit={editingEntry ? unitFor(editingEntry.item) : 'serving'}
                index={editingIndex + 1}
                total={ingredients.length}
                mealName={mealName.trim()}
                onUnitChange={u => editingEntry && setUnit(editingEntry.item.id, u)}
                onQtyChange={raw => editingEntry && setDisplayQty(editingEntry.item, raw, unitFor(editingEntry.item))}
                onStep={dir => editingEntry && stepQty(editingEntry.item, unitFor(editingEntry.item), dir)}
                onRemove={() => {
                  if (!editingEntry) return
                  const id = editingEntry.item.id
                  setEditingIngredientId(null)
                  removeIngredient(id)
                }}
                onClose={() => setEditingIngredientId(null)}
              />
            </div>

            {duplicateOf && (
              <div className="shrink-0 px-4 pb-2">
                <DuplicateMealPrompt
                  existingName={duplicateOf.name}
                  saving={saving}
                  onUpdate={() => { const m = duplicateOf; setDuplicateOf(null); setDuplicateAnswered(true); void handleSave(m) }}
                  onSaveAsNew={() => { setDuplicateOf(null); setDuplicateAnswered(true); void handleSave() }}
                />
              </div>
            )}
            <MealBuilderFooter
              hasIngredients={ingredients.length > 0}
              batchKcal={totalMacros.kcal}
              protein={totalMacros.protein}
              carbs={totalMacros.carbs}
              fat={totalMacros.fat}
              servings={mealServings}
              saving={saving}
              editing={editingMeal != null}
              canSave={!!mealName.trim() && ingredients.length > 0}
              onSave={handleSave}
            />
            </>
            )}
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
