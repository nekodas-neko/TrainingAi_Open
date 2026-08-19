'use client'

import { memo } from 'react'
import { barBands, barPosition } from '@trainingai/shared/nutrition/calorie-balance'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

const BANDS = barBands()

/**
 * The five-band zone scale with a marker, and a line saying where the budget came from.
 *
 * Extracted from `CalorieBalanceBar` (Q-401) so Home's nutrition card and the Nutrition tab draw
 * the **same** bar rather than two that drift — the sibling-surface rule, and the reason the two
 * surfaces disagreed to begin with. The bands are decorative; the reading is the marker plus
 * whatever label the caller puts above it.
 *
 * Scalar props on purpose (Q-490): `memo` compares shallowly, and this renders inside Home's card
 * switch where an object literal would defeat it silently.
 */
export const CalorieZoneBar = memo(function CalorieZoneBar({
  deviationKcal, zoneColor, restingBaseKcal, activeKcal, targetNetKcal, compact,
}: {
  deviationKcal: number
  zoneColor: string
  restingBaseKcal: number
  activeKcal: number
  targetNetKcal: number
  /** Home's card is dense — drop the end labels and tighten the bar. */
  compact?: boolean
}) {
  const pos = barPosition(deviationKcal)
  const { base, earned } = budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal })

  return (
    <>
      <div
        className={`relative rounded-full overflow-hidden flex ${compact ? 'h-1.5' : 'h-3'}`}
        role="presentation"
      >
        {BANDS.map(band => (
          <div key={band.zone} style={{ width: `${band.widthPct}%`, backgroundColor: band.color, opacity: 0.35 }} />
        ))}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-full transition-[left] duration-500 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${pos * 100}% - 2px)`, backgroundColor: zoneColor, boxShadow: '0 0 0 2px var(--background)' }}
        />
      </div>

      {!compact && (
        <div className="mt-1.5 flex justify-between text-[9px] uppercase tracking-wide text-muted-foreground/70">
          <span>Under-eating</span>
          <span>On target</span>
          <span>Over-eating</span>
        </div>
      )}

      {/* Q-401 point 4. A budget that grows during the day reads as a bug unless it says why —
          which is literally how this entry started ("why are these values different?"). */}
      <p className={`${compact ? 'mt-1' : 'mt-2'} text-[10px] leading-snug text-muted-foreground tabular-nums`}>
        {earned > 0
          ? <>{base.toLocaleString()} base <span className="text-muted-foreground/70">+</span> {earned.toLocaleString()} earned from movement</>
          : <>{base.toLocaleString()} base — nothing earned from movement yet today</>}
      </p>
    </>
  )
})
