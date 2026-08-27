'use client'

import { memo, useCallback } from 'react'
import { Search, X, Loader2, Sparkles, Link2 } from 'lucide-react'
import { asHttpsUrl, hostOf } from './recipe-url'
import { RecipeImageButton } from './recipe-image-button'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { FoodRow } from '@/components/nutrition/food-row'
import type { FoodSearchResponse } from '@/app/api/nutrition/food-search/route'
import { macroCalorieDisagreement, MACRO_MISMATCH_VISIBLE_LIMIT } from '@trainingai/shared/nutrition/scan-totals'

export type ExternalFood = FoodSearchResponse['results'][number]

interface Props {
  query: string
  onQueryChange: (v: string) => void
  /** Foods the user already has — local first, so these work offline. */
  searchResults: FoodItem[]
  onAdd: (item: FoodItem) => void
  estimating: boolean
  onEstimate: () => void
  /** Importing a pasted recipe link (BF-11c). Runs instead of the estimate, never beside it. */
  importing: boolean
  onImportRecipe: (url: string) => void
  /** BF-40: the same import, from a picture, for content that has no URL to paste. */
  onImportRecipeImage: (image: string, mimeType: string) => void
  dbResults: ExternalFood[]
  dbSearching: boolean
  dbUnavailable: boolean
  addingExternal: string | null
  onAddExternal: (food: ExternalFood) => void
  showAddFood: boolean
  onAddByHand: () => void
}

/**
 * Finding an ingredient to put in a meal.
 *
 * Three sources, in the order they can be trusted. The user's **own foods** are instant and work
 * offline. The **AI estimate** always works and is how the library actually grows — this used to be
 * the missing piece: search only ever looked at foods you had already saved, so it could never
 * return anything new. The **food database** (Open Food Facts, the same source the barcode scanner
 * uses) is a bonus, shown when it responds. Its relevance was fixed in v1.291.0 (region filter plus
 * a whole-word name match, because it matches on ingredient lists and returned cheese for "milk"),
 * but it is a third party that rate-limits and goes down, so nothing here depends on it — and its
 * rows carry a warning when their own macros and calories disagree.
 */
export function IngredientSearch({
  query, onQueryChange, searchResults, onAdd,
  estimating, onEstimate, importing, onImportRecipe, onImportRecipeImage,
  dbResults, dbSearching, dbUnavailable, addingExternal, onAddExternal,
  showAddFood, onAddByHand,
}: Props) {
  const recipeUrl = asHttpsUrl(query.trim())
  return (
    <>
      {/* Ingredient search */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add ingredients</label>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search your foods or the food database…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
              className="-mr-1 flex h-11 w-11 flex-none items-center justify-center text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-1.5">
          {/* Headed, because the list was already here and read as unexplained (BF-11c §5.3).
              `searchFoodItems('')` returns the twenty most recently updated foods — the browse-all
              path — so the picker was never type-to-search only. What it lacked was a word saying
              what you were looking at, next to a "Food database" heading that had one. */}
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {query.trim() ? 'Your foods' : 'Recently used'}
          </p>
          {/* Q-406: the calories move out of the secondary line into the shared right-hand column,
              which is what lets a list of foods line up. What a "serving" weighs stays, because it
              is what the quantity control counts in and "1 serving" is meaningless without it. */}
          <div className="rounded-xl border divide-y divide-border/30 overflow-hidden">
            {searchResults.map(item => (
              <SearchResultRow key={item.id} item={item} onAdd={onAdd} />
            ))}
          </div>
        </div>
      )}

      {recipeUrl ? (
        // A pasted link is unambiguous, so it REPLACES the estimate rather than sitting beside it:
        // running an AI estimate over the text of a URL produces a food called "https" with
        // invented macros, which is worse than no offer at all.
        <button
          onClick={() => onImportRecipe(recipeUrl)}
          disabled={importing}
          className="w-full min-h-[48px] flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-left active:bg-brand/5 disabled:opacity-50"
        >
          {importing
            ? <Loader2 className="h-4 w-4 animate-spin flex-none text-brand" />
            : <Link2 className="h-4 w-4 flex-none text-brand" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {importing ? `Reading ${hostOf(recipeUrl)}…` : `Import the recipe from ${hostOf(recipeUrl)}`}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Every ingredient is added at its own weight, and each one is saved to your foods.
            </span>
          </span>
        </button>
      ) : query.trim().length < 2 ? (
        // Offered only on an EMPTY search, where nothing else is: a typed query means the estimate
        // row below, and a pasted link means the row above. Neither competes with a picture, and a
        // third permanent button would crowd the one control that matters here — the search itself.
        <RecipeImageButton importing={importing} onPick={onImportRecipeImage} />
      ) : (
        <button
          onClick={onEstimate}
          disabled={estimating}
          className="w-full min-h-[48px] flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-left active:bg-brand/5 disabled:opacity-50"
        >
          {estimating
            ? <Loader2 className="h-4 w-4 animate-spin flex-none text-brand" />
            : <Sparkles className="h-4 w-4 flex-none text-brand" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium truncate">
              {estimating ? `Working out "${query.trim()}"…` : `Add "${query.trim()}" — work out its macros`}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Estimated, then saved to your foods. Say the portion if it matters.
            </span>
          </span>
        </button>
      )}

      {!recipeUrl && query.trim().length >= 2 && (dbSearching || dbResults.length > 0 || dbUnavailable) && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Food database
            {dbSearching && <Loader2 className="w-3 h-3 animate-spin" />}
          </p>
          {dbUnavailable ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              The food database is not responding right now. Use the estimate above, or add
              the food by hand below.
            </p>
          ) : dbResults.map(food => {
            // Food-database entries are filled in field by field by different contributors, so a
            // product can state 96 kcal beside macros that come to 122. Below the sanitiser's
            // rewrite threshold it lands as-is, so say so rather than let the row look verified.
            const off = macroCalorieDisagreement(food)
            const mismatched = off != null && off > MACRO_MISMATCH_VISIBLE_LIMIT
            return (
              <ExternalFoodRow
                key={food.externalId}
                food={food}
                mismatched={mismatched}
                adding={addingExternal != null}
                pending={addingExternal === food.externalId}
                onAdd={onAddExternal}
              />
            )
          })}
        </div>
      )}

      {!recipeUrl && query.trim() && searchResults.length === 0 && dbResults.length === 0 && !dbSearching && !showAddFood && (
        <p className="text-sm text-muted-foreground">
          No results for &ldquo;{query}&rdquo;.{' '}
          <button
            className="text-brand underline font-medium"
            onClick={onAddByHand}
          >
            + Add &ldquo;{query}&rdquo; as new food
          </button>
        </p>
      )}
    </>
  )
}

/** Wrapper so the memoised row gets a stable `onPress` from inside a `.map()`, where a hook cannot
 *  live and an inline arrow would defeat `React.memo` silently (Q-490). */
const SearchResultRow = memo(function SearchResultRow(
  { item, onAdd }: { item: FoodItem; onAdd: (i: FoodItem) => void },
) {
  const press = useCallback(() => onAdd(item), [item, onAdd])
  const serving = (item.servingSizeG ?? 0) > 0 ? `${Math.round(item.servingSizeG!)} g serving` : 'serving'
  return (
    <FoodRow
      name={item.name}
      secondary={`${Math.round(item.proteinG ?? 0)}g P per ${serving}`}
      calories={item.calories}
      onPress={press}
    />
  )
})

/**
 * The external food-database result, as the shared row (Q-406's last call site).
 *
 * **It loses its trailing `+` and per-row spinner deliberately.** `SearchResultRow` above — the
 * sibling that has been `FoodRow` since v1.338.0 — has neither: the tap adds the food, and an add
 * affordance on top of that is a per-screen difference, which is what converting these rows exists
 * to end. The tapped row still says so, through `highlighted`, so nothing about *which* row is being
 * added is lost.
 *
 * A wrapper rather than an inline arrow, because the row is memoised and an inline `onPress` inside
 * `.map()` defeats that silently (Q-490).
 */
const ExternalFoodRow = memo(function ExternalFoodRow(
  { food, mismatched, adding, pending, onAdd }:
  { food: ExternalFood; mismatched: boolean; adding: boolean; pending: boolean; onAdd: (f: ExternalFood) => void },
) {
  const press = useCallback(() => onAdd(food), [food, onAdd])
  const secondary = `${Math.round(food.proteinG ?? 0)}P · ${Math.round(food.carbsG ?? 0)}C · ${Math.round(food.fatG ?? 0)}F per ${Math.round(food.servingSizeG)} g`
  return (
    <FoodRow
      name={food.brand ? `${food.brand} — ${food.name}` : food.name}
      secondary={secondary}
      calories={food.calories}
      warning={mismatched ? 'Its macros and calories disagree — check before using' : null}
      highlighted={pending}
      onPress={press}
      disabled={adding}
    />
  )
})
