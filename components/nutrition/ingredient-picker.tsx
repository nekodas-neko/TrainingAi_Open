'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { FoodItem, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { ingredientToEntry } from '@trainingai/shared/nutrition/log-plan-meal'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { getLocalStore } from '@/lib/local-store'
import { AddFoodByHandForm, type AddFoodByHandValues } from './add-food-by-hand-form'
import { IngredientSearch, type ExternalFood } from './ingredient-search'
import { hostOf } from './recipe-url'
import type { RecipeCandidate } from './recipe-candidates'
import type { FoodSearchResponse } from '@/app/api/nutrition/food-search/route'

interface Props {
  /** Whether the picker's screen is on. Both searches idle when it is not. */
  active: boolean
  userId?: string
  /** Hand an acquired food up. The picker clears its own query; the parent owns the meal. */
  onAdd: (item: FoodItem) => void
  /**
   * A whole recipe, imported from a pasted link (BF-11c).
   *
   * Separate from `onAdd` because a recipe is not one ingredient: it carries a name, a batch size
   * and N foods at their own weights, and the builder already owns fields for all three.
   * `recipeYield` is `null` when the page never stated one — see `importRecipe` below.
   */
  onImportRecipe: (recipe: { name: string; entries: { item: FoodItem; qty: number }[]; recipeYield: number | null }) => void
  /**
   * A page that held several dishes (BF-11c §5.2). Handed up UNCONVERTED — no food items are minted
   * until the user says which dishes to keep, or a four-recipe page would add four meals' worth of
   * foods to the library for one press.
   */
  onRecipeCandidates: (candidates: RecipeCandidate[]) => void
}

/**
 * Acquiring an ingredient — the three ways a food gets into a meal, and the state behind them.
 *
 * Split out of `saved-meals-sheet.tsx` (BF-11a), which held the meals list, selection mode, the
 * build form, quantity editing and all of this in one 774-line file, 26 lines under the CI ceiling
 * with four more features due to land in it.
 *
 * It pairs with `ingredient-search.tsx` rather than duplicating it: that file draws the results and
 * owns no state, this one owns the searches, the debounce clocks and the three add paths. Neither
 * is useful without the other and neither repeats the other's job.
 */
export function IngredientPicker({ active, userId, onAdd, onImportRecipe, onRecipeCandidates }: Props) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const [dbResults, setDbResults] = useState<ExternalFood[]>([])
  const [dbSearching, setDbSearching] = useState(false)
  const [dbUnavailable, setDbUnavailable] = useState(false)
  const [addingExternal, setAddingExternal] = useState<string | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showAddFood, setShowAddFood] = useState(false)
  const [addFoodSaving, setAddFoodSaving] = useState(false)

  useEffect(() => {
    if (!active) return
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
  }, [query, active, userId])

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
    if (!active) return
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
  }, [query, active])

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

  function accept(item: FoodItem) {
    onAdd(item)
    setQuery('')
    setSearchResults([])
  }

  /**
   * An external hit is not a food item yet. Create it, then add it — so it lands in the user's own
   * library and is searchable locally (and offline) from then on.
   */
  async function addExternalFood(food: ExternalFood) {
    setAddingExternal(food.externalId)
    try {
      accept(await createFoodItem({
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

  /**
   * A pasted recipe link becomes the ingredients of the meal being built (BF-11c).
   *
   * **The conversion is `ingredientToEntry`, not a local one.** It stores each food per 100 g and
   * puts the weight in the quantity, so the library gains "Cooked quinoa" rather than "Cooked
   * quinoa (236 g)" — and it is the same function the plan's copy-to-library path uses, so a recipe
   * imported here and the same recipe saved from a plan mint identical numbers. A second conversion
   * would drift the first time either side rounded differently.
   *
   * **`recipeYield: null` is handed straight up rather than defaulted to 1.** It means the page
   * never said how many the recipe serves, so the payload is the WHOLE batch — a banana-bread page
   * measured 1,956 kcal for the loaf. Deciding here that it is one portion is exactly the four-fold
   * calorie error that reads as plausible; the builder has a batch-size field and asks instead.
   */
  async function importRecipe(url: string) {
    setImporting(true)
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = res.ok ? await res.json() : null
      const ingredients: NutritionIngredient[] = Array.isArray(body?.ingredients) ? body.ingredients : []
      if (ingredients.length === 0) {
        toast.error(offlineHint() ?? 'No recipe could be read from that page')
        return
      }
      // Several dishes: ask which, before minting anything. The top level is `candidates[0]`, so
      // taking it and stopping would silently drop the rest of the page.
      const candidates: RecipeCandidate[] = Array.isArray(body.candidates)
        ? body.candidates.filter((c: RecipeCandidate) => Array.isArray(c?.ingredients) && c.ingredients.length > 0)
        : []
      if (candidates.length > 1) {
        onRecipeCandidates(candidates)
        setQuery('')
        setSearchResults([])
        return
      }
      // Serial, not `Promise.all`: each one writes the same local table and queues its own outbox
      // row, and a nine-ingredient recipe is not worth racing them for. Same reasoning, same shape
      // as `savePlanMealToLibrary`.
      const entries: { item: FoodItem; qty: number }[] = []
      for (const ing of ingredients) {
        const entry = ingredientToEntry(ing)
        const item = await createFoodItem(entry, userId)
        // The schema floor is 0.01, and a sub-gram garnish rounds to 0.00 two decimals in.
        entries.push({ item, qty: Math.max(0.01, entry.quantityMultiplier) })
      }
      onImportRecipe({
        name: typeof body.name === 'string' ? body.name : hostOf(url),
        entries,
        recipeYield: typeof body.recipeYield === 'number' ? body.recipeYield : null,
      })
      setQuery('')
      setSearchResults([])
    } catch {
      toast.error(offlineHint() ?? 'Could not read that recipe')
    } finally {
      setImporting(false)
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
      // Test that the scan RETURNED, not that its calories are nonzero (LA-30). Zero is what the
      // AI correctly reports for a supplement or a black coffee, and treating it as a failed scan
      // is the same defect `review-step.tsx` carried — different consequence, same rule.
      if (!scan || scan.error || typeof scan.calories !== 'number') {
        toast.error(`Could not work out the macros for "${text}"`)
        return
      }
      accept(await createFoodItem({
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

  // Returns whether the food was created, so `AddFoodByHandForm` clears itself only on success —
  // the previous version cleared the fields in the same block that hid the form, so a failed save
  // would have thrown away what the user typed had it ever reached that line.
  async function handleAddFoodAndIngredient(v: AddFoodByHandValues): Promise<boolean> {
    if (!v.name || isNaN(v.calories)) { toast.error('Name and calories are required'); return false }
    setAddFoodSaving(true)
    try {
      accept(await createFoodItem({
        name: v.name, calories: v.calories,
        proteinG: v.proteinG, carbsG: v.carbsG, fatG: v.fatG,
        servingSizeG: 100,
        source: 'manual',
      }, userId))
      setShowAddFood(false)
      toast.success(`${v.name} added`)
      return true
    } catch {
      toast.error(offlineHint() ?? 'Failed to add food')
      return false
    } finally {
      setAddFoodSaving(false)
    }
  }

  return (
    <>
      <IngredientSearch
        query={query}
        onQueryChange={setQuery}
        searchResults={searchResults}
        onAdd={accept}
        estimating={estimating}
        onEstimate={() => void estimateAndAdd()}
        importing={importing}
        onImportRecipe={url => void importRecipe(url)}
        dbResults={dbResults}
        dbSearching={dbSearching}
        dbUnavailable={dbUnavailable}
        addingExternal={addingExternal}
        onAddExternal={food => void addExternalFood(food)}
        showAddFood={showAddFood}
        onAddByHand={() => setShowAddFood(true)}
      />

      {showAddFood && (
        <AddFoodByHandForm
          saving={addFoodSaving}
          initialName={query.trim()}
          onCancel={() => setShowAddFood(false)}
          onSubmit={handleAddFoodAndIngredient}
        />
      )}
    </>
  )
}
