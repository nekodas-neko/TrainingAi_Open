'use client'

import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { macroShares } from './macro-energy'

interface Props {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  targets: NutritionTargets | null
  /** Kcal earned from today's movement, from `budgetProvenance(...)` — the same addend the zone
   *  bar names, so the ring and the bar cannot disagree about it (Q-417). */
  earnedKcal?: number | null
}

export function MacroRing({ calories, proteinG, carbsG, fatG, targets, earnedKcal }: Props) {
  const calTarget = targets?.calories ?? 2000
  const remaining = Math.max(0, calTarget - calories)
  const pct = Math.min(100, Math.round((calories / calTarget) * 100))
  const ringMask = 'radial-gradient(farthest-side, transparent 69%, black 70% 89%, transparent 90%)'

  /**
   * The arc still measures progress toward the calorie goal — its total sweep is `pct` — but it is
   * split by where those calories came from (Q-395b). One ring, three segments: a second ring for
   * the macros was the alternative and the design pass rejected it.
   *
   * Degrees are accumulated rather than each segment being placed independently, so rounding cannot
   * open a hairline gap between two colours.
   */
  const shares = macroShares({ proteinG, carbsG, fatG })
  const sweep = pct * 3.6
  const proteinEnd = shares.protein * sweep
  const carbsEnd = proteinEnd + shares.carbs * sweep
  const arc = sweep > 0 && (shares.protein + shares.carbs + shares.fat) > 0
    ? `conic-gradient(from -90deg,`
      + ` ${MACRO_COLORS.protein} 0deg ${proteinEnd}deg,`
      + ` ${MACRO_COLORS.carbs} ${proteinEnd}deg ${carbsEnd}deg,`
      + ` ${MACRO_COLORS.fat} ${carbsEnd}deg ${sweep}deg,`
      + ` transparent ${sweep}deg)`
    // No macros logged but calories are: the goal-progress arc is still true, so it draws in brand
    // rather than vanishing.
    : sweep > 0
      ? `conic-gradient(from -90deg, var(--brand) ${sweep}deg, transparent ${sweep}deg)`
      : 'transparent'

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
              background: arc,
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
          <div className="flex items-baseline justify-between mb-3">
            <span className="text-xs text-muted-foreground">
              {/* "movement", not "cardio": the figure is strength sessions + logged activities +
                  steps (`computeActiveEnergy`), so on a leg day it would have credited a whole
                  session to cardio. Same wording the zone bar uses for the same quantity. */}
              {earnedKcal != null && earnedKcal > 0 ? `+${Math.round(earnedKcal)} from movement` : 'Daily goal'}
            </span>
            <span className="text-xs font-semibold tabular-nums">{remaining > 0 ? `${remaining} left` : 'Goal reached'}</span>
          </div>
          <div className="space-y-2">
            <MacroBar label="Protein" value={proteinG} target={targets?.proteinG ?? 150} share={shares.protein} color={MACRO_COLORS.protein} />
            <MacroBar label="Carbs"   value={carbsG}   target={targets?.carbsG   ?? 250} share={shares.carbs}   color={MACRO_COLORS.carbs} />
            <MacroBar label="Fat"     value={fatG}      target={targets?.fatG     ?? 80}  share={shares.fat}     color={MACRO_COLORS.fat} />
          </div>
        </div>
      </div>
    </div>
  )
}

function MacroBar({ label, value, target, share, color }: { label: string; value: number; target: number; share: number; color: string }) {
  const pct = Math.min(100, Math.round((value / target) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">
        {label}
        {/* The share the arc is drawn from, said in words beside it — a coloured segment on its own
            does not tell you it is 34%, and the colour is the only thing tying the two together. */}
        <i className="block text-[10px] not-italic tabular-nums opacity-70">{Math.round(share * 100)}%</i>
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted/40">
        <div
          className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none"
          style={{ transform: `scaleX(${pct / 100})`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-16 text-right shrink-0">
        {Math.round(value)}/{Math.round(target)}g
      </span>
    </div>
  )
}
