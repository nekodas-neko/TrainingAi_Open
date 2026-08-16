'use client'

import { memo } from 'react'
import { cn } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import {
  mealFit,
  type MacroFit, type MacroTotals,
} from '@trainingai/shared/nutrition/meal-macro-fit'

/**
 * A meal's actual food against the macros it was planned for, as four bars.
 *
 * Two text lines of numbers could not answer the question the owner asked — "so you know clearly
 * what changing the meal does" — because working out that 60 g of carbs against a 90 g target is
 * the problem, and not the protein, meant reading eight numbers and subtracting. A bar per macro
 * makes the short one obvious at a glance, and the signed delta beside it says by how much.
 *
 * Status is never carried by colour alone: an off-target macro always shows its signed delta, so
 * the reading survives a colour-blind user and a greyscale screenshot.
 */

const OFF_TARGET = '#f97316'

function Bar({ fit, label, color }: {
  fit: MacroFit
  label: string
  color: string
}) {
  // Fill is capped at 100% so an overshoot cannot render past the track; the overshoot is stated in
  // the delta instead, where it carries its sign.
  const pct = Math.max(0, Math.min(1, fit.ratio)) * 100
  const off = fit.status !== 'on'

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[10px] font-semibold text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: `${color}26` }}>
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-[5.5rem] shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {Math.round(fit.actual).toLocaleString()}/{Math.round(fit.target).toLocaleString()}
      </span>
      <span
        className={cn('w-11 shrink-0 text-right text-[10px] font-semibold tabular-nums',
          off ? '' : 'text-muted-foreground/60')}
        style={off ? { color: OFF_TARGET } : undefined}
      >
        {off ? `${fit.delta > 0 ? '+' : '−'}${Math.abs(Math.round(fit.delta)).toLocaleString()}` : '✓'}
      </span>
    </div>
  )
}

export const MealMacroBars = memo(function MealMacroBars({
  actual, target, className,
}: {
  actual: MacroTotals
  target: MacroTotals
  className?: string
}) {
  const fit = mealFit(actual, target)
  return (
    <div className={cn('space-y-1', className)}>
      <Bar fit={fit.calories} label="kcal" color="#a3a3a3" />
      <Bar fit={fit.protein} label="P" color={MACRO_COLORS.protein} />
      <Bar fit={fit.carbs} label="C" color={MACRO_COLORS.carbs} />
      <Bar fit={fit.fat} label="F" color={MACRO_COLORS.fat} />
    </div>
  )
})

/**
 * The day's running total against the day's target.
 *
 * This is the number a swap is really judged against — a meal 100 kcal short only matters if the
 * day is also short. Rendered above the meal list so the effect of changing one meal is visible
 * without scrolling back up.
 */
export const DayMacroTotals = memo(function DayMacroTotals({
  actual, target, plannedCount, totalCount,
}: {
  actual: MacroTotals
  target: MacroTotals
  /** Meals that have ingredients to sum. Fewer than `totalCount` means the total is incomplete. */
  plannedCount: number
  totalCount: number
}) {
  const fit = mealFit(actual, target)
  const cal = fit.calories
  const partial = plannedCount < totalCount
  // Calories alone would call a day "on target" while it was 105 g short on carbs and 38 g over on
  // fat — the exact reading a real generation produced. The badge answers for all four.
  const verdict = fit.allOnTarget
    ? 'On target'
    : cal.status !== 'on'
      ? `${cal.delta > 0 ? 'Over' : 'Under'} by ${Math.abs(Math.round(cal.delta)).toLocaleString()} kcal`
      : 'Calories fine, macros off'
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Day total
        </span>
        {!partial && (
          <span
            className="text-[10px] font-semibold tabular-nums"
            style={fit.allOnTarget ? { color: MACRO_COLORS.protein } : { color: OFF_TARGET }}
          >
            {verdict}
          </span>
        )}
      </div>
      <div className="mt-2">
        <MealMacroBars actual={actual} target={target} />
      </div>
      {partial && (
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          {totalCount - plannedCount} of {totalCount} meals have no ingredients yet, so this total is
          short by however much they would add.
        </p>
      )}
    </div>
  )
})
