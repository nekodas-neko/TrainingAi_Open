'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { FoodItem, NutritionIngredient, NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { ingredientToEntry } from '@trainingai/shared/nutrition/log-plan-meal'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { getLocalStore } from '@/lib/local-store'
import { AddFoodByHandForm, type AddFoodByHandValues } from './add-food-by-hand-form'
import { IngredientSearch } from './ingredient-search'
import { hostOf } from './recipe-url'
import type { RecipeCandidate } from './recipe-candidates'
import { useFoodDatabaseSearch, type ExternalFood } from '@/lib/hooks/use-food-database-search'
import { BarcodeScanner } from './barcode-scanner'
import { decodeMealLabelScan } from '@trainingai/shared/nutrition/label-payload'

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
 * owns no state, this one owns the own-foods search and the three add paths. Neither is useful
 * without the other and neither repeats the other's job. The database search left for
 * `useFoodDatabaseSearch` in BF-48, once Log Food needed the same query.
 */
export function IngredientPicker({ active, userId, onAdd, onImportRecipe, onRecipeCandidates }: Props) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const { results: dbResults, searching: dbSearching, unavailable: dbUnavailable } =
    useFoodDatabaseSearch(query, active)
  const [addingExternal, setAddingExternal] = useState<string | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showAddFood, setShowAddFood] = useState(false)
  const [addFoodSaving, setAddFoodSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)

  // The database search runs on its own clock in `useFoodDatabaseSearch`, deliberately not chained
  // behind this one: they are independent queries, and chaining them meant a slow library fetch
  // delayed the database section while a stalled one removed it entirely.
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
   * A scanned packet becomes an ingredient of the meal being built (BF-63).
   *
   * **Not `CaptureActions`, though it holds the same scanner.** That component's hit goes to the
   * food logger and lands on today's diary — reusing it here would silently log breakfast while the
   * user thought they were writing a recipe. What a scan means inside a builder is `addExternalFood`
   * with a different source, so that is the shape.
   *
   * **`source: 'barcode'`, and that is the whole reason this is not the search path.** A barcode
   * identifies one exact product; a name search returns a plausible near-match picked off a list.
   *
   * **The code itself is NOT stored, and that is deliberate rather than forgotten.** `barcode` is
   * NULL on every `food_items` row in production, including the three whose `source` already says
   * `'barcode'` — `/api/nutrition/barcode` does not return the code it looked up, and `NewFoodItem`
   * has no field to carry it. Threading it means the route, the shared create path, the local table
   * and the outbox payload, all of which are Lane A and all of which are BF-38's subject. This path
   * defers to it rather than adding a fourth writer of NULL.
   */
  async function addScannedFood(code: string) {
    setScanning(false)
    // A printed meal label is a saved meal, not a product, and scanned inside a builder it would
    // mean "nest this meal as an ingredient" — which does not exist. Say so, rather than handing the
    // payload to a product lookup that can only 400 it.
    //
    // `decodeMealLabelScan`, not `decodeMealLabelToken` (BF-57): labels now carry the whole recipe,
    // which is a ~250-character string that the token check does not recognise — so without this the
    // newer labels are the ones that fall through to the barcode route. Sibling surface to the same
    // swap in `capture-actions.tsx`; the two are the only places a camera reaches a meal label.
    if (decodeMealLabelScan(code)) {
      toast.error('That is a meal label. Scan a product barcode to add it as an ingredient.')
      return
    }
    setLookingUp(true)
    try {
      const res = await fetch(`/api/nutrition/barcode?code=${encodeURIComponent(code)}`)
      const data = await res.json()
      // The route draws the distinction, so keep it: a database that is down is not a product that
      // does not exist, and telling the user the second when it is the first sends them to re-scan.
      if (data.unavailable) { toast.error('The food database is not responding. Try again, or add it by hand.'); return }
      if (!res.ok) { toast.error('Barcode lookup failed.'); return }
      if (data.notFound) { toast.error('That barcode is not in the database. Add it by hand, or photograph the label.'); return }
      const scan = data as NutritionScanResult
      accept(await createFoodItem({
        name: scan.name,
        brand: scan.brand,
        servingSizeG: scan.servingSizeG,
        calories: scan.calories,
        proteinG: scan.proteinG,
        carbsG: scan.carbsG,
        fatG: scan.fatG,
        fiberG: scan.fiberG,
        sugarG: scan.sugarG,
        sodiumMg: scan.sodiumMg,
        satFatG: scan.satFatG,
        source: 'barcode',
      }, userId))
    } catch {
      toast.error(offlineHint() ?? 'Network error looking up barcode.')
    } finally {
      setLookingUp(false)
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
    return importRecipeFrom({ url }, hostOf(url), 'No recipe could be read from that page')
  }

  /**
   * A recipe from a SCREENSHOT rather than a link (BF-40).
   *
   * The owner's case is a Google AI overview: the ingredients are rendered into Google's own results
   * page with the source behind a chip, so there is no recipe URL to paste and the image is the only
   * handle on that content.
   *
   * `imageKind: 'recipe'` is the entire difference at the route — without it the model is asked to
   * estimate a finished plate from a picture of a word list. **`recipeYield` still comes back null**,
   * because a screenshot carries no JSON-LD and nothing here invents one: the builder's batch-size
   * field asks, which is the same refusal the URL path makes and for the same reason.
   */
  async function importRecipeImage(image: string, mimeType: string) {
    return importRecipeFrom({ image, mimeType, imageKind: 'recipe' }, 'Recipe', 'No recipe could be read from that image')
  }

  /**
   * Everything both import paths do, which is everything except the request body.
   *
   * Extracted rather than copied: the multi-candidate branch, the serial minting, the 0.01 floor and
   * the `recipeYield` refusal below are the parts that took two entries to get right, and a second
   * copy of them is a second place for them to drift.
   */
  async function importRecipeFrom(payload: Record<string, unknown>, fallbackName: string, emptyMessage: string) {
    setImporting(true)
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = res.ok ? await res.json() : null
      const ingredients: NutritionIngredient[] = Array.isArray(body?.ingredients) ? body.ingredients : []
      if (ingredients.length === 0) {
        toast.error(offlineHint() ?? emptyMessage)
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
        name: typeof body.name === 'string' ? body.name : fallbackName,
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

  // Mutation-checked by `e2e/builder-barcode-scan.spec.ts`: removing this returns the picker and
  // the scan button never goes away.
  if (scanning) return <BarcodeScanner onResult={code => void addScannedFood(code)} onClose={() => setScanning(false)} />

  return (
    <>
      <IngredientSearch
        onScan={() => setScanning(true)}
        lookingUpBarcode={lookingUp}
        query={query}
        onQueryChange={setQuery}
        searchResults={searchResults}
        onAdd={accept}
        estimating={estimating}
        onEstimate={() => void estimateAndAdd()}
        importing={importing}
        onImportRecipe={url => void importRecipe(url)}
        onImportRecipeImage={(image, mimeType) => void importRecipeImage(image, mimeType)}
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
