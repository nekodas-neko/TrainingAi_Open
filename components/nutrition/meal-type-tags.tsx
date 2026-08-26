'use client'

import { memo, useMemo } from 'react'
import type { MealType } from '@trainingai/shared/types/nutrition'
import { ChipGroup } from '@/components/ui/chip-group'

interface Props {
  /** The user's live meal types. State-held by the sheet, so its identity is stable per load. */
  mealTypes: MealType[]
  /** Meal-type ids, state-held by the sheet for the same reason. */
  selected: string[]
  onToggle: (mealTypeId: string) => void
}

/**
 * Which slots a saved meal belongs in (BF-11f).
 *
 * **Untagged means every slot, not none** — the planner's filter
 * (`packages/shared/src/nutrition/library-match.ts`) returns true for a meal with no tags, and the
 * copy below has to say so, because chips with nothing ticked otherwise read as "excluded from
 * everything". The inverse reading is what would shrink a whole library to zero on the day this
 * shipped.
 *
 * Memoised with array props whose identity is React state rather than a fresh `.map()` at the call
 * site — the mapping to `{ value, label }` happens here, inside the memo, for that reason (Q-490).
 */
export const MealTypeTags = memo(function MealTypeTags({ mealTypes, selected, onToggle }: Props) {
  const options = useMemo(
    () => mealTypes.map(mt => ({ value: mt.id, label: mt.name })),
    [mealTypes],
  )
  return (
    <ChipGroup
      heading="Good for"
      options={options}
      selected={selected}
      onToggle={onToggle}
      emptyLabel="No meal types set up yet — add them in Nutrition settings."
      hint={
        selected.length === 0
          ? 'Nothing picked, so a meal plan can use this at any meal.'
          : 'A meal plan will only put this in the meals you picked.'
      }
    />
  )
})
