'use client'

import { Minus, Plus } from 'lucide-react'
import { SegmentedTabs } from '@/components/ui/segmented-tabs'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import type { FoodItem } from '@trainingai/shared/types/nutrition'
import type { QtyUnit } from './saved-meal-qty'

interface Props {
  item: FoodItem
  /** Always a serving multiplier, whichever unit is on screen. */
  qty: number
  unit: QtyUnit
  onUnitChange: (unit: QtyUnit) => void
  onQtyChange: (raw: string) => void
  onStep: (direction: 1 | -1) => void
  autoFocus?: boolean
}

/**
 * How much of one food — the stepper, the unit toggle, the presets and the live macro line.
 *
 * BF-26: there were **two** of these. The meal builder's matched artboard 6; the diary's, which is
 * reached far more often, offered no unit toggle, multiplier presets instead of absolute ones, and
 * four identical uncoloured macro columns. The owner's *"everything looks the same"* was literally
 * true of it — the `−`, the value and the `+` were the same square, so the number the sheet exists
 * to set carried no more weight than the buttons that nudge it.
 *
 * Both sheets render this now, so the answer to "what does editing a quantity look like" is in one
 * place. Grams is offered only where there is a serving size to divide by: `qtyFromInput` returns
 * null for grams without one, and a chip that cannot apply is worse than a chip that is not there.
 */
export function QuantityEditor({ item, qty, unit, onUnitChange, onQtyChange, onStep, autoFocus }: Props) {
  const servingG = item.servingSizeG ?? 0
  const displayed = unit === 'g'
    ? Math.round((servingG || 100) * qty)
    : Math.round(qty * 100) / 100

  const presets: { label: string; raw: string; unit: QtyUnit }[] = [
    { label: '1 srv', raw: '1', unit: 'serving' },
    { label: '2 srv', raw: '2', unit: 'serving' },
    { label: '3 srv', raw: '3', unit: 'serving' },
    ...(servingG > 0 ? [{ label: '100 g', raw: '100', unit: 'g' as QtyUnit }] : []),
  ]

  const macros: { key: keyof typeof MACRO_COLORS; letter: string; value: number }[] = [
    { key: 'protein', letter: 'P', value: (item.proteinG ?? 0) * qty },
    { key: 'carbs', letter: 'C', value: (item.carbsG ?? 0) * qty },
    { key: 'fat', letter: 'F', value: (item.fatG ?? 0) * qty },
  ]

  return (
    <div className="space-y-4">
      {servingG > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {/* "1 serving of THIS FOOD", not a portion of the meal — the meal's own batch size is a
              separate control and the two were reading as the same word. */}
          1 serving of {item.name} = {Math.round(servingG)} g
        </p>
      )}

      {/* BF-26 ③: the value is the tall element and the steppers are not — they were the same
          square at the same fill, which is what made the number disappear into its own controls.
          **`!text-2xl`, not `text-2xl`:** `globals.css` sets `input { font-size: 16px !important }`
          under `max-width:640px` to stop iOS zooming on focus, so a plain size class on an input is
          inert at every phone width — i.e. on the only runtime that matters. The guard wants a
          FLOOR of 16 px and 24 px clears it, so overriding it here does not reintroduce the zoom. */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onStep(-1)}
          aria-label={`Less ${item.name}`}
          className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-muted active:bg-muted/60"
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
          autoFocus={autoFocus}
          aria-label={unit === 'g' ? `Grams of ${item.name}` : `Servings of ${item.name}`}
          className="h-14 min-w-0 flex-1 rounded-xl bg-muted px-3 text-center !text-2xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-brand [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => onStep(1)}
          aria-label={`More ${item.name}`}
          className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-muted active:bg-muted/60"
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
            className="min-h-12 rounded-xl bg-muted px-4 text-sm font-semibold transition-colors active:bg-muted/60"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* BF-26 ②: the same P/C/F colours the row behind this sheet already uses. The strip used to be
          four monochrome columns with `kcal` among them at equal weight, so the headline number was
          not a headline. */}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        <span className="text-base font-bold">{Math.round((item.calories ?? 0) * qty)}</span>
        <span className="text-xs text-muted-foreground">kcal</span>
        {macros.map(m => (
          <span key={m.key} className="text-sm font-semibold" style={{ color: MACRO_COLORS[m.key] }}>
            {m.letter} {Math.round(m.value * 10) / 10}
          </span>
        ))}
      </p>
    </div>
  )
}
