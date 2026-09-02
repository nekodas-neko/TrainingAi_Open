'use client'

import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { MEAL_SCALES, type MealScale } from './meal-portion-scale'

/**
 * How much of a saved meal is being logged (BF-104).
 *
 * The owner: *"when logging food/meals we should be able to choose how much of the meal; i.e full at
 * 1x or 1.5 or 0.5 etc."*
 *
 * **Discrete taps, never a free-number field**, which the entry is explicit about. Three options are
 * what he named, and a keyboard for a value that is almost always one of three is a worse control
 * than three buttons — it also cannot be used one-handed while holding a plate.
 *
 * **`SegmentedTabs`, not `QuantityEditor`.** The entry says to reuse rather than add a third quantity
 * control, and `QuantityEditor` is the wrong one to reuse: it edits a **single food** in grams or
 * servings, with a stepper, a unit toggle and macro tiles. This is a **meal-level** portion, and the
 * primitive `QuantityEditor` itself uses for its own toggle is the one that fits.
 *
 * **This is log-time and has nothing to do with `servings`.** A meal's `servings` is how many
 * portions the recipe makes — a definition-time property. This is how much of one portion was eaten.
 * A meal can make four portions and be eaten one and a half at a sitting; the two multiply.
 */

interface Props {
  value: MealScale
  onChange: (value: MealScale) => void
}

export function MealPortionPicker({ value, onChange }: Props) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        How much
      </p>
      <SegmentedTabs tabs={MEAL_SCALES} value={value} onValueChange={onChange} />
    </div>
  )
}
