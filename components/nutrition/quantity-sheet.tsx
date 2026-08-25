'use client'

import { Trash2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import { QuantityEditor } from './quantity-editor'
import type { QtyUnit } from './saved-meal-qty'

interface Props {
  /** The ingredient being edited, or null when the sheet is closed. */
  item: FoodItem | null
  qty: number
  unit: QtyUnit
  /** 1-based position and list length, for the provenance line. */
  index: number
  total: number
  mealName: string
  onUnitChange: (unit: QtyUnit) => void
  onQtyChange: (raw: string) => void
  onStep: (direction: 1 | -1) => void
  onRemove: () => void
  onClose: () => void
}

/**
 * Editing one ingredient's quantity, on its own screen (Q-395a).
 *
 * Finding 12 retired the list-row editor: a row in a list carries no editor at all, and the
 * quantity control lives here instead. That is what lets every food in the app draw as the one
 * shared `FoodRow` — a row with a stepper, a number field and a unit toggle inside it cannot.
 *
 * **The header says where you came from.** Q-395's design pass is explicit that a sheet arriving
 * with only a food name reads as an unrelated screen: the tapped row stays lit under the scrim and
 * this is headed `Ingredient N of M · <meal>`.
 *
 * Both units, the way MyFitnessPal does it, because each alone is unusable for half the cases:
 * grams cannot say "two scoops" without the user knowing what a scoop weighs, and a bare multiplier
 * cannot say "137 g of chicken". Either way the stored value is the serving multiplier — grams is a
 * second view of the same number, not a second number.
 */
export function QuantitySheet({
  item, qty, unit, index, total, mealName,
  onUnitChange, onQtyChange, onStep, onRemove, onClose,
}: Props) {
  return (
    <Sheet open={item != null} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="bottom">
        <SheetHeader className="px-1 pb-0">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ingredient {index} of {total} · {mealName || 'this meal'}
          </p>
          <SheetTitle className="truncate">{item?.name ?? ''}</SheetTitle>
        </SheetHeader>

        {item && (
          <div className="space-y-4 px-4 pb-4">
            <QuantityEditor
              item={item}
              qty={qty}
              unit={unit}
              onUnitChange={onUnitChange}
              onQtyChange={onQtyChange}
              onStep={onStep}
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={onRemove}
                aria-label={`Remove ${item.name}`}
                className="flex min-h-12 w-12 flex-none items-center justify-center rounded-xl bg-destructive/10"
              >
                <Trash2 className="h-5 w-5 text-destructive" />
              </button>
              <Button className="h-12 flex-1 font-semibold" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
