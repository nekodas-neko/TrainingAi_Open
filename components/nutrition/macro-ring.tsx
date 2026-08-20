'use client'

import { memo } from 'react'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'

interface Props {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  /** The day's budget from `ringTargets` — null when the day has no derived baseline. */
  calorieTarget: number | null
  proteinTarget: number | null
  carbsTarget: number | null
  fatTarget: number | null
  /** kcal the day's movement added to the budget. */
  earnedKcal: number
}

/**
 * The Nutrition tab's calorie ring and macro bars.
 *
 * Scalar props rather than the `NutritionTargets` row (Q-417): the targets it renders are the day's
 * *scaled* ones, which are not a row, and passing scalars keeps the memo working. What it must never
 * do again is derive a budget of its own — see `ring-targets.ts` for why there were three.
 */
export const MacroRing = memo(function MacroRing({
  calories, proteinG, carbsG, fatG, calorieTarget, proteinTarget, carbsTarget, fatTarget, earnedKcal,
}: Props) {
  const remaining = calorieTarget != null ? Math.round(calorieTarget - calories) : null
  const pct = calorieTarget != null ? Math.min(100, Math.round((calories / calorieTarget) * 100)) : 0
  const ringMask = 'radial-gradient(farthest-side, transparent 69%, black 70% 89%, transparent 90%)'

  return (
    <div className="rounded-2xl bg-muted/60 border border-border px-4 py-4">
      <div className="flex items-center gap-5">
        {/* Ring — conic-gradient + mask instead of an animated SVG stroke-dashoffset,
            which is unreliable on the Samsung WebView compositor. */}
        <div className="relative w-24 h-24 flex-none">
          <div
            className="absolute inset-0 rounded-full text-muted-foreground/30"
            style={{ background: 'currentColor', WebkitMask: ringMask, mask: ringMask }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: pct > 0
                ? `conic-gradient(from -90deg, var(--brand) ${pct * 3.6}deg, transparent ${pct * 3.6}deg)`
                : 'transparent',
              WebkitMask: ringMask,
              mask: ringMask,
            }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold leading-none tabular-nums">{Math.round(calories)}</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">kcal</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-3 gap-2">
            {/* Q-417: this said "from cardio". The figure is `computeActiveEnergy` — strength
                sessions and steps included — so on a leg day it credited a leg session to cardio.
                "From movement" is the wording the bar above it already uses for the same quantity. */}
            <span className="text-xs text-muted-foreground">
              {earnedKcal > 0 ? `+${Math.round(earnedKcal).toLocaleString()} from movement` : 'Daily goal'}
            </span>
            {remaining != null && (
              <span className="text-xs font-semibold tabular-nums">
                {remaining >= 0 ? `${remaining.toLocaleString()} left` : `${Math.abs(remaining).toLocaleString()} over`}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <MacroBar label="Protein" value={proteinG} target={proteinTarget} color={MACRO_COLORS.protein} />
            <MacroBar label="Carbs"   value={carbsG}   target={carbsTarget}   color={MACRO_COLORS.carbs} />
            <MacroBar label="Fat"     value={fatG}     target={fatTarget}     color={MACRO_COLORS.fat} />
          </div>
        </div>
      </div>
    </div>
  )
})

function MacroBar({ label, value, target, color }: { label: string; value: number; target: number | null; color: string }) {
  const pct = target != null && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted/40">
        <div
          className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none"
          style={{ transform: `scaleX(${pct / 100})`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-16 text-right shrink-0">
        {Math.round(value)}{target != null ? `/${Math.round(target)}` : ''}g
      </span>
    </div>
  )
}
