'use client'

import { Minus, Plus, Trash2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { cn } from '@trainingai/shared/utils'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
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
  const servingG = item?.servingSizeG ?? 0
  const displayed = unit === 'g'
    ? Math.round((servingG || 100) * qty)
    : Math.round(qty * 100) / 100

  // The drawing's row of shortcuts. Grams is offered only when there is a serving size to divide
  // by — `qtyFromInput` returns null for grams without one, so a chip that cannot apply is worse
  // than a chip that is not there.
  const presets: { label: string; raw: string; unit: QtyUnit }[] = [
    { label: '1 srv', raw: '1', unit: 'serving' },
    { label: '2 srv', raw: '2', unit: 'serving' },
    { label: '3 srv', raw: '3', unit: 'serving' },
    ...(servingG > 0 ? [{ label: '100 g', raw: '100', unit: 'g' as QtyUnit }] : []),
  ]

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
            {servingG > 0 && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {/* "1 serving of THIS FOOD", not a portion of the meal — the meal's own batch size
                    is a separate control and the two were reading as the same word. */}
                1 serving of {item.name} = {Math.round(servingG)} g
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => onStep(-1)}
                aria-label={`Less ${item.name}`}
                className="flex-none w-12 h-12 rounded-xl bg-muted flex items-center justify-center"
              >
                <Minus className="h-5 w-5" />
              </button>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={unit === 'g' ? 5 : 0.5}
                value={displayed}
                onChange={e => onQtyChange(e.target.value)}
                autoFocus
                aria-label={unit === 'g' ? `Grams of ${item.name}` : `Servings of ${item.name}`}
                className="min-w-0 flex-1 h-14 rounded-xl bg-muted px-3 text-2xl font-bold tabular-nums text-center outline-none focus:ring-2 focus:ring-brand [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => onStep(1)}
                aria-label={`More ${item.name}`}
                className="flex-none w-12 h-12 rounded-xl bg-muted flex items-center justify-center"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            {/* An item with no serving size has no gram equivalent, so it only ever offers servings. */}
            {servingG > 0 && (
              <SegmentedTabs
                tabs={[{ value: 'serving' as QtyUnit, label: 'srv' }, { value: 'g' as QtyUnit, label: 'g' }]}
                value={unit}
                onValueChange={onUnitChange}
                size="xs"
              />
            )}

            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => { onUnitChange(p.unit); onQtyChange(p.raw) }}
                  className={cn(
                    'min-h-12 rounded-xl bg-muted px-4 text-sm font-semibold transition-colors active:bg-muted/60',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <p className="text-sm tabular-nums text-muted-foreground">
              {Math.round((item.calories ?? 0) * qty)} kcal ·{' '}
              {Math.round((item.proteinG ?? 0) * qty * 10) / 10}P ·{' '}
              {Math.round((item.carbsG ?? 0) * qty * 10) / 10}C ·{' '}
              {Math.round((item.fatG ?? 0) * qty * 10) / 10}F
            </p>

            <div className="flex gap-2">
              <button
                onClick={onRemove}
                aria-label={`Remove ${item.name}`}
                className="flex-none min-h-12 w-12 rounded-xl bg-destructive/10 flex items-center justify-center"
              >
                <Trash2 className="h-5 w-5 text-destructive" />
              </button>
              <Button className="flex-1 h-12 font-semibold" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
