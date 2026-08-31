'use client'

import { memo, useCallback } from 'react'
import { Search, X, Loader2, Sparkles, Link2, ScanBarcode } from 'lucide-react'
import { asHttpsUrl, hostOf } from './recipe-url'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { FoodRow } from '@/components/nutrition/food-row'
import { FoodDatabaseResults } from './food-database-results'
import type { ExternalFood } from '@/lib/hooks/use-food-database-search'

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
  dbResults: ExternalFood[]
  dbSearching: boolean
  dbUnavailable: boolean
  addingExternal: string | null
  onAddExternal: (food: ExternalFood) => void
  showAddFood: boolean
  onAddByHand: () => void
  /**
   * Open the barcode scanner (BF-63). Log Food has had `Photo · Barcode · Describe` since it
   * shipped, and the builder — one screen further into the same sheet — offered only the text
   * field, so a packet ingredient had to be typed out.
   */
  onScan: () => void
  /** A scan is being looked up. Its result arrives as an ingredient, so there is nothing else to show. */
  lookingUpBarcode: boolean
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
  estimating, onEstimate, importing, onImportRecipe,
  dbResults, dbSearching, dbUnavailable, addingExternal, onAddExternal,
  showAddFood, onAddByHand, onScan, lookingUpBarcode,
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
          {/* Inside the field, not a fourth button under it: this is another way to fill the same
              box, and the row already carries the clear button at that scale. */}
          <button
            onClick={onScan}
            disabled={lookingUpBarcode}
            aria-label="Scan a barcode"
            className="-mr-1 flex h-11 w-11 flex-none items-center justify-center text-muted-foreground disabled:opacity-60"
          >
            {lookingUpBarcode ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanBarcode className="w-4 h-4" />}
          </button>
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

      {/* **The recipe-photo button used to live in this slot and moved to the builder's source row
          with BF-52.** It was rendered only on an EMPTY search, and the URL offer only on a pasted
          one, so the two were mutually exclusive renders of one place — which is why neither was
          findable without already knowing.

          **The URL branch STAYS, and not only for convenience.** Without it a pasted link falls
          through to the estimate below, and running an AI estimate over the text of a URL produces a
          food called "https" with invented macros. It is a guard as much as an affordance. */}
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
      ) : query.trim().length < 2 ? null : (
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
        <FoodDatabaseResults
          results={dbResults}
          searching={dbSearching}
          unavailable={dbUnavailable}
          addingId={addingExternal}
          onAdd={onAddExternal}
          unavailableHint="The food database is not responding right now. Use the estimate above, or add the food by hand below."
        />
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
