'use client'

import { memo, useMemo } from 'react'
import { Apple, Dumbbell, Moon, Sun, Sunrise, Utensils, type LucideIcon } from 'lucide-react'
import type { MealType } from '@trainingai/shared/types/nutrition'

/** Past this many tags a row shows the first four icons and "+N" (issue 2154: four at 384 px). */
export const MEAL_TYPE_ICON_CAP = 4

/**
 * A lucide glyph for a meal type, by its name (issue 2154).
 *
 * Meal types are USER-CREATED, so a fixed map cannot know every name. Anything it does not
 * recognise gets `Utensils`, never nothing. Order matters: "Pre Workout (Breakfast)" must hit
 * breakfast before the generic workout rule.
 */
const RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/breakfast|\bpre\b|morning/i, Sunrise],
  [/\bpost\b|workout/i, Dumbbell],
  [/lunch|midday|noon/i, Sun],
  [/dinner|supper|evening|\bnight\b/i, Moon],
  [/snack|afternoon/i, Apple],
]

export function mealTypeIcon(name: string): LucideIcon {
  for (const [re, icon] of RULES) if (re.test(name)) return icon
  return Utensils
}

/** The tagged types that still exist, in the user's own meal order. Unknown ids are dropped (a
 *  deleted type), and untagged (empty) yields none: untagged means "any meal", not "excluded". */
export function taggedMealTypes(mealTypes: MealType[], mealTypeIds: string[] | undefined): MealType[] {
  if (!mealTypeIds || mealTypeIds.length === 0) return []
  return mealTypes
    .filter(mt => mealTypeIds.includes(mt.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

interface Props {
  /** The user's live meal types, state-held by the sheet so its identity is stable. */
  mealTypes: MealType[]
  mealTypeIds: string[] | undefined
}

/** Which meals a saved meal can be used for, as a row of small glyphs. Renders nothing when untagged. */
export const MealTypeIcons = memo(function MealTypeIcons({ mealTypes, mealTypeIds }: Props) {
  const tagged = useMemo(() => taggedMealTypes(mealTypes, mealTypeIds), [mealTypes, mealTypeIds])
  if (tagged.length === 0) return null
  const shown = tagged.slice(0, MEAL_TYPE_ICON_CAP)
  const extra = tagged.length - shown.length
  const label = `Good for ${tagged.map(t => t.name).join(', ')}`
  return (
    <span role="img" aria-label={label} title={label} className="mt-1 flex items-center gap-1.5 text-muted-foreground">
      {shown.map(t => {
        const Icon = mealTypeIcon(t.name)
        return <Icon key={t.id} aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
      })}
      {extra > 0 && <span aria-hidden="true" className="text-[10px] font-semibold tabular-nums">+{extra}</span>}
    </span>
  )
})
