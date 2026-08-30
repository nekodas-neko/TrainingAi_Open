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
 *
 * **The layout is BF-46 ③'s Option A, chosen by the owner from three drawings at 412 dp.** Top to
 * bottom: the serving line, the stepper with the unit toggle stacked in a narrow column to its
 * right, four presets spanning the full width, the calorie total alone at the largest type on the
 * sheet, then three macro tiles. The owner's sentence was *"the grams/serve could be smaller and to
 * the right of the − x + button then the other buttons could be enlarged and spread to match the
 * width it has"* — moving the toggle out of its own full-width row is what frees that width.
 *
 * **The one place the build departs from the drawing, and why.** The drawing puts the toggle at the
 * stepper's height. Every `button` in this app carries a 48 dp floor (`globals.css`), so a stacked
 * two-option toggle is **96 px** and cannot be shrunk to meet a 56 px stepper — the alternative was
 * `.tap-dense`, which exists for inline text buttons, not for a real control. So the STEPPER grew
 * to 96 px instead, which the drawing's own intent supports: the value is meant to be the tallest,
 * heaviest thing here. A food with no serving size has no toggle and keeps the short row.
 *
 * The entry warns Option A is the tallest of the three and may scroll on a long food name. If it
 * does, tighten the gaps — do not merge the total and the macros back into one line, which is
 * option B and a settled question.
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

  const macros: { key: keyof typeof MACRO_COLORS; name: string; value: number }[] = [
    { key: 'protein', name: 'Protein', value: (item.proteinG ?? 0) * qty },
    { key: 'carbs', name: 'Carbs', value: (item.carbsG ?? 0) * qty },
    { key: 'fat', name: 'Fat', value: (item.fatG ?? 0) * qty },
  ]

  return (
    <div className="space-y-4">
      {servingG > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {/* The food's name sits directly above this in both sheets' titles, so it is not repeated
              here — but "serving" still needs qualifying against the meal's own portions, which is
              a separate control one screen away. */}
          1 serving = {Math.round(servingG)} g
        </p>
      )}

      {/* BF-26 ③: the value is the tall element and the steppers are not — they were the same
          square at the same fill, which is what made the number disappear into its own controls.
          **`!text-3xl`, not `text-3xl`:** `globals.css` sets `input { font-size: 16px !important }`
          under `max-width:640px` to stop iOS zooming on focus, so a plain size class on an input is
          inert at every phone width — i.e. on the only runtime that matters. The guard wants a
          FLOOR of 16 px and 30 px clears it, so overriding it here does not reintroduce the zoom. */}
      <div className={`flex items-center gap-2 ${servingG > 0 ? 'h-24' : 'h-14'}`}>
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
          className="h-full min-w-0 flex-1 rounded-xl bg-muted px-3 text-center !text-3xl font-bold tabular-nums outline-none focus:ring-2 focus:ring-brand [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => onStep(1)}
          aria-label={`More ${item.name}`}
          className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-muted active:bg-muted/60"
        >
          <Plus className="h-5 w-5" />
        </button>
        {/* An item with no serving size has no gram equivalent, so it only ever offers servings —
            and then this column is absent and the row above is short. */}
        {servingG > 0 && (
          <SegmentedTabs
            tabs={[{ value: 'serving' as QtyUnit, label: 'srv' }, { value: 'g' as QtyUnit, label: 'g' }]}
            value={unit}
            onValueChange={onUnitChange}
            size="xs"
            orientation="vertical"
            className="h-full w-14 flex-none"
          />
        )}
      </div>

      {/* Equal columns spanning the width, not a wrapping flex row: the presets were a cramped four
          on one line and the point of moving the toggle was to give them this space. */}
      <div className={`grid gap-2 ${presets.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => { onUnitChange(p.unit); onQtyChange(p.raw) }}
            className="min-h-12 rounded-xl bg-muted text-sm font-semibold transition-colors active:bg-muted/60"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* The result, in two blocks rather than one line. The calorie figure leads with nothing
          beside it; the macros are three equal tiles under it. This is the height Option A costs
          and the distinctness it was chosen for. */}
      <div className="text-center">
        <p className="text-4xl font-bold leading-none tabular-nums">{Math.round((item.calories ?? 0) * qty)}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">kcal</p>
      </div>

      {/* BF-26 ②'s macro colours, kept — four uncoloured columns were the "everything looks the
          same" complaint. Spelled out rather than P/C/F, which is what the drawing shows and what
          keeps the colour from being the only thing carrying the meaning. */}
      <div className="grid grid-cols-3 gap-2">
        {macros.map(m => (
          <div key={m.key} className="rounded-xl border border-border bg-muted/30 py-2 text-center">
            <p className="text-base font-bold tabular-nums" style={{ color: MACRO_COLORS[m.key] }}>
              {Math.round(m.value * 10) / 10}
              <span className="text-[11px] font-semibold">g</span>
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{m.name}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
