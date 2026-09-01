'use client'

import { Droplets, UtensilsCrossed, Plus } from 'lucide-react'

interface Props {
  /** Today's water, in millilitres. Null when the day has none — not the same as zero. */
  todayWaterMl: number | null
  /** Disabled until meal types load, since the bucket cannot be picked without them. */
  canLogFood: boolean
  onLogFood: () => void
  onLogWater: () => void
  onOpenSavedMeals: () => void
}

/**
 * The Nutrition tab's actions, directly under the macro ring.
 *
 * They used to be placed by scroll depth (Q-237): Saved Meals sat below every meal card, so where it
 * landed depended on how many meals the day had, and Water was mid-scroll for the same reason.
 *
 * Extracted from `nutrition-content.tsx` when adding Log Food took that file to 803 lines (Q-257) —
 * the size rule asks for extraction rather than appending, and an action row is a self-contained
 * thing rather than a fragment of the screen's state.
 */
export function NutritionActionRow({
  todayWaterMl, canLogFood, onLogFood, onLogWater, onOpenSavedMeals,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        onClick={onLogFood}
        disabled={!canLogFood}
        className="min-h-[48px] flex items-center gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-3 active:bg-muted/20 transition-colors disabled:opacity-60"
      >
        <Plus className="w-4 h-4 text-muted-foreground flex-none" />
        <span className="text-sm font-semibold flex-1 text-left">Log Food</span>
      </button>

      <button
        onClick={onLogWater}
        className="min-h-[48px] flex items-center gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-3 active:bg-muted/20 transition-colors"
      >
        <Droplets className="w-4 h-4 text-muted-foreground flex-none" />
        <span className="text-sm font-semibold flex-1 text-left">Water</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {todayWaterMl != null ? `${(todayWaterMl / 1000).toFixed(1)} L` : '—'}
        </span>
      </button>

      {/* BF-45 ①: `col-span-2` is a CONSEQUENCE of the row being three buttons in a two-column
          grid, not a design decision about My Foods. Row 2 held one button and dead space beside
          it. A fourth action reclaims that slot and this span comes off — which is why it is worth
          saying so here rather than leaving the next person to guess it was deliberate. */}
      <button
        onClick={onOpenSavedMeals}
        className="col-span-2 min-h-[48px] flex items-center gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-3 active:bg-muted/20 transition-colors"
      >
        <UtensilsCrossed className="w-4 h-4 text-muted-foreground flex-none" />
        {/* `My Foods`, matching the tab it lands on (BF-103). BF-37 put `My Meals` here to break up
            the `My Foods`/`My Meals` pair the owner could not tell apart; unifying on one name
            satisfies that reasoning rather than contradicting it. Do not split them again. */}
        <span className="text-sm font-semibold flex-1 text-left">My Foods</span>
      </button>
    </div>
  )
}
