'use client'

import { memo } from 'react'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { CalorieProgressBar } from '@/components/nutrition/calorie-progress-bar'
import { movementSummary, STEP_BASELINE } from '@/components/nutrition/movement-breakdown'

/**
 * The day's calorie progress, and a line saying where the budget came from.
 *
 * Extracted from `CalorieBalanceBar` (Q-401) so Home's nutrition card and the Nutrition tab draw
 * the **same** bar rather than two that drift — the sibling-surface rule, and the reason the two
 * surfaces disagreed to begin with. Q-323 turned the five-band gauge into a progress bar; both
 * callers already print `zoneLabel` in words beside it, so the colour is never the only signal.
 *
 * Scalar props on purpose (Q-490): `memo` compares shallowly, and this renders inside Home's card
 * switch where an object literal would defeat it silently.
 */
export const CalorieZoneBar = memo(function CalorieZoneBar({
  intakeKcal, restingBaseKcal, activeKcal, targetNetKcal,
  workoutKcal, activityKcal, stepsKcal, compact,
}: {
  intakeKcal: number
  restingBaseKcal: number
  activeKcal: number
  targetNetKcal: number
  /** The three addends of `activeKcal`, from the service's `activeBreakdown` (BF-87). Scalars, not
   *  the object — `memo` compares shallowly and an object literal at a call site defeats it. */
  workoutKcal: number
  activityKcal: number
  stepsKcal: number
  /** Home's card is dense — tighten the bar. */
  compact?: boolean
}) {
  const { base, earned, total } = budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal })
  const parts = movementSummary({ workoutKcal, activityKcal, stepsKcal })

  return (
    <>
      <CalorieProgressBar intakeKcal={intakeKcal} budgetKcal={total} height={compact ? 'h-1.5' : 'h-3'} />

      {/* Q-401 point 4. A budget that grows during the day reads as a bug unless it says why —
          which is literally how this entry started ("why are these values different?"). */}
      {/* BF-87. "Nothing earned from movement yet today" was true and unexplainable: the owner had
          1,196 steps on the same screen and no way to know that only steps above the baseline
          count. The threshold is what answers it — naming the shortfall alone does not, because a
          user with a 7,000 step goal still cannot tell how many of those convert. */}
      <p className={`${compact ? 'mt-1' : 'mt-2'} text-[10px] leading-snug text-muted-foreground tabular-nums`}>
        {earned > 0
          ? <>
              {base.toLocaleString()} base <span className="text-muted-foreground/70">+</span> {earned.toLocaleString()} earned from movement
              {parts && <span className="text-muted-foreground/70"> ({parts})</span>}
            </>
          : <>{base.toLocaleString()} base — nothing earned from movement yet; steps count above {STEP_BASELINE.toLocaleString()}/day</>}
      </p>
    </>
  )
})
