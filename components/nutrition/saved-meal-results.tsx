'use client'

import { memo } from 'react'
import { Plus } from 'lucide-react'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

/**
 * The builder's fourth source: meals you have already saved (BF-161).
 *
 * Lifted out of `ingredient-search.tsx` the way `food-database-results.tsx` was — that file is the
 * search's layout and `saved-meals-sheet.tsx` is 12 lines under the 800-line ceiling, so a new
 * source goes in a child rather than onto either.
 *
 * **A meal added here is flattened into its ingredients, not nested.** The row therefore says what
 * it will add — *"5 ingredients · 612 kcal"* — rather than naming the meal as a component of the
 * one being built. Nothing here may read as a live link back to the source: editing that meal later
 * does not change what this adds, and `saved-meal-flatten.ts` explains why that is the accepted
 * trade rather than an oversight.
 */
export const SavedMealResults = memo(function SavedMealResults({
  meals, onAdd,
}: { meals: SavedMeal[]; onAdd: (meal: SavedMeal) => void }) {
  if (meals.length === 0) {
    return <p className="text-sm text-muted-foreground">No saved meals match that.</p>
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Your meals
      </p>
      <div className="rounded-xl border divide-y divide-border/30 overflow-hidden">
        {meals.map(meal => {
          const count = meal.items.length
          return (
            <button
              key={meal.id}
              onClick={() => onAdd(meal)}
              className="flex w-full min-h-[48px] items-center gap-3 px-3 py-2 text-left active:bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{meal.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {count === 1 ? '1 ingredient' : `${count} ingredients`}
                  {' · adds them individually'}
                </span>
              </span>
              <span className="flex-none text-sm tabular-nums text-muted-foreground">
                {Math.round(meal.totals.calories)} kcal
              </span>
              <Plus className="h-4 w-4 flex-none text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </div>
  )
})
