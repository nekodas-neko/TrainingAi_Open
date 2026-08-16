'use client'

import { Plus, Minus, Trash2 } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type { FoodItem } from '@trainingai/shared/types/nutrition'

/** How a row's quantity is being *entered*. What gets stored is always a serving multiplier. */
export type QtyUnit = 'serving' | 'g'

interface Props {
  item: FoodItem
  qty: number
  unit: QtyUnit
  onUnitChange: (unit: QtyUnit) => void
  onQtyChange: (raw: string) => void
  onStep: (direction: 1 | -1) => void
  onRemove: () => void
}

/**
 * One ingredient in the meal builder, with its quantity in servings **or** grams.
 *
 * Both units, the way MyFitnessPal does it, because each alone is unusable for half the cases:
 * grams cannot say "two scoops" without the user knowing what a scoop weighs, and a bare multiplier
 * cannot say "137 g of chicken". Servings is the default — it is what someone means when they add a
 * scoop of whey. Either way the stored value is the serving multiplier; grams is a second view of
 * the same number, not a second number.
 */
export function IngredientRow({ item, qty, unit, onUnitChange, onQtyChange, onStep, onRemove }: Props) {
  const servingG = item.servingSizeG ?? 0
  const displayed = unit === 'g'
    ? Math.round((servingG || 100) * qty)
    : Math.round(qty * 100) / 100

  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {Math.round((item.calories ?? 0) * qty)} kcal ·{' '}
            {Math.round((item.proteinG ?? 0) * qty * 10) / 10}P ·{' '}
            {Math.round((item.carbsG ?? 0) * qty * 10) / 10}C ·{' '}
            {Math.round((item.fatG ?? 0) * qty * 10) / 10}F
          </p>
        </div>
        <button
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className="flex-none w-11 h-11 -mt-1 -mr-1 rounded-lg bg-destructive/10 flex items-center justify-center"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={() => onStep(-1)}
          aria-label={`Less ${item.name}`}
          className="flex-none w-11 h-11 rounded-lg bg-muted flex items-center justify-center"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={unit === 'g' ? 5 : 0.5}
          value={displayed}
          onChange={e => onQtyChange(e.target.value)}
          aria-label={unit === 'g' ? `Grams of ${item.name}` : `Servings of ${item.name}`}
          className="min-w-0 flex-1 min-h-[44px] rounded-lg bg-muted px-2 text-sm font-bold tabular-nums text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => onStep(1)}
          aria-label={`More ${item.name}`}
          className="flex-none w-11 h-11 rounded-lg bg-muted flex items-center justify-center"
        >
          <Plus className="h-4 w-4" />
        </button>
        {/* An item with no serving size has no gram equivalent, so it only ever offers servings. */}
        {servingG > 0 ? (
          <div className="flex-none flex rounded-lg bg-muted p-0.5" role="group" aria-label={`Unit for ${item.name}`}>
            {(['serving', 'g'] as QtyUnit[]).map(u => (
              <button
                key={u}
                onClick={() => onUnitChange(u)}
                aria-pressed={unit === u}
                className={cn(
                  'min-h-[40px] px-2.5 rounded-md text-[11px] font-semibold transition-colors',
                  unit === u ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {u === 'serving' ? 'srv' : 'g'}
              </button>
            ))}
          </div>
        ) : (
          <span className="flex-none px-2 text-[11px] text-muted-foreground">srv</span>
        )}
      </div>

      {servingG > 0 && (
        <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
          {/* "1 serving of THIS FOOD", not a portion of the meal — the meal's own batch size is a
              separate control further up and the two were reading as the same word. */}
          1 serving of {item.name} = {Math.round(servingG)} g
          {unit === 'serving' && ` · using ${Math.round(servingG * qty)} g`}
        </p>
      )}
    </div>
  )
}
