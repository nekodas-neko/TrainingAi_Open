'use client'

import { memo } from 'react'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { progressBands, progressFill } from './calorie-progress'

/**
 * The day's calories as a bar you finish (Q-323), drawn on both Home's nutrition card and the
 * Nutrition tab.
 *
 * **This was `CalorieZoneBar`, a five-band scale with a marker on it, and the rename is the change.**
 * A marker mid-track at 8am and mid-track again at 8pm reads as a dial: it answers "am I on target"
 * and says nothing about how much of the day is done. The owner asked for the other thing — *"all
 * the way like a progress bar with the green towards the end, and then a little orange/red bar
 * after… where you want to go to the end."* The zone map survives underneath as a faint track, so
 * the bar still shows where on-target *is* while the fill shows where you are.
 *
 * One component for both surfaces on purpose (Q-401): two hand-maintained copies of this scale are
 * exactly what put two different calorie budgets on one screen.
 *
 * Scalar props (Q-490): `memo` compares shallowly and this renders inside Home's card switch, where
 * an object literal at the call site would defeat the memo silently.
 */
export const CalorieProgressBar = memo(function CalorieProgressBar({
  deviationKcal, restingBaseKcal, activeKcal, targetNetKcal, compact,
}: {
  deviationKcal: number
  restingBaseKcal: number
  activeKcal: number
  targetNetKcal: number
  /** Home's card is dense — drop the end labels and tighten the bar. */
  compact?: boolean
}) {
  const { base, earned, total } = budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal })
  const bands = progressBands(total)
  const { fillPct, goalPct, label, color, remainingKcal } = progressFill(deviationKcal, total)

  return (
    <>
      <div
        className={`relative rounded-full overflow-hidden flex ${compact ? 'h-2' : 'h-3.5'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.max(0, total + deviationKcal)}
        aria-valuetext={`${(total + deviationKcal).toLocaleString()} of ${total.toLocaleString()} kcal — ${label}`}
      >
        {bands.map(band => (
          <div key={band.zone} style={{ width: `${band.widthPct}%`, backgroundColor: band.color, opacity: 0.28 }} />
        ))}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${fillPct}%`, backgroundColor: color }}
        />
        {/* The goal notch. Without it the green band is just a colour change and the bar has no
            visible end to walk to, which is the whole request. */}
        <div
          className="absolute inset-y-0 w-0.5"
          style={{ left: `calc(${goalPct}% - 1px)`, backgroundColor: 'var(--foreground)', opacity: 0.55 }}
        />
      </div>

      {/* Colour is never the only signal (repo rule) — and on the compact bar this line is the only
          place the state is stated at all, since Home's card has no zone headline above it. */}
      <div className={`${compact ? 'mt-1' : 'mt-1.5'} flex items-baseline justify-between gap-2 text-[10px] tabular-nums`}>
        <span className="font-semibold" style={{ color }}>{label}</span>
        <span className="text-muted-foreground">
          {remainingKcal >= 0
            ? `${remainingKcal.toLocaleString()} kcal to go`
            : `${Math.abs(remainingKcal).toLocaleString()} kcal over`}
        </span>
      </div>

      {/* Q-401 point 4. A budget that grows during the day reads as a bug unless it says why —
          which is literally how this entry started ("why are these values different?"). */}
      <p className={`${compact ? 'mt-0.5' : 'mt-1.5'} text-[10px] leading-snug text-muted-foreground tabular-nums`}>
        {earned > 0
          ? <>{base.toLocaleString()} base <span className="text-muted-foreground/70">+</span> {earned.toLocaleString()} earned from movement</>
          : <>{base.toLocaleString()} base — nothing earned from movement yet today</>}
      </p>
    </>
  )
})
