'use client'

import { memo, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { FoodRow } from './food-row'
import type { ExternalFood } from '@/lib/hooks/use-food-database-search'
import { macroCalorieDisagreement, MACRO_MISMATCH_VISIBLE_LIMIT } from '@trainingai/shared/nutrition/scan-totals'

interface Props {
  results: ExternalFood[]
  searching: boolean
  unavailable: boolean
  /** `externalId` of the row being added, or null. One at a time — adding writes to the library. */
  addingId: string | null
  onAdd: (food: ExternalFood) => void
  /**
   * What to offer instead when the database is down. The meal builder has an AI estimate and an
   * add-by-hand form on the same screen; Log Food has neither, so it says something shorter.
   */
  unavailableHint: string
}

/**
 * Results from the food database, drawn the same way wherever they are searched from.
 *
 * Lifted out of `ingredient-search.tsx` for BF-48, which put the same section on Log Food → Single
 * foods. The half worth not duplicating is the mismatch warning: a product's fields are filled in
 * by different contributors, so it can state 96 kcal beside macros that come to 122, and below the
 * sanitiser's rewrite threshold that lands as-is. A second copy of that threshold check is a second
 * place for a row to start looking verified when it is not.
 */
export function FoodDatabaseResults({ results, searching, unavailable, addingId, onAdd, unavailableHint }: Props) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Food database
        {searching && <Loader2 className="w-3 h-3 animate-spin" />}
      </p>
      {unavailable ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{unavailableHint}</p>
      ) : results.map(food => {
        const off = macroCalorieDisagreement(food)
        return (
          <ExternalFoodRow
            key={food.externalId}
            food={food}
            mismatched={off != null && off > MACRO_MISMATCH_VISIBLE_LIMIT}
            adding={addingId != null}
            pending={addingId === food.externalId}
            onAdd={onAdd}
          />
        )
      })}
    </div>
  )
}

/**
 * The external food-database result, as the shared row (Q-406's last call site).
 *
 * **It loses its trailing `+` and per-row spinner deliberately.** `SearchResultRow` — the sibling
 * that has been `FoodRow` since v1.338.0 — has neither: the tap adds the food, and an add
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
