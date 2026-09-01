'use client'

import { memo } from 'react'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { CalorieProgressBar } from '@/components/nutrition/calorie-progress-bar'
import { movementSummary } from '@/components/nutrition/movement-breakdown'

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
  const { earned, total } = budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal })
  const parts = movementSummary({ workoutKcal, activityKcal, stepsKcal })
  // BF-99. `budgetProvenance().base` is `restingBaseKcal + targetNetKcal` — the resting base with
  // the GOAL DELTA already folded in — and this line called it "base". On a recomp that prints a
  // number ~200 below the owner's measured RMR, so he went looking for a broken calculation:
  // *"why is my base rate under the 1350 RMR value."* Every figure on the screen reconciled; the
  // word did not. The two are separated here rather than in `budgetProvenance`, which is shared and
  // whose `base` is the right thing for a caller that wants one number. They still sum to `total`.
  const restingBase = Math.round(restingBaseKcal)
  const goalDelta = Math.round(targetNetKcal)

  return (
    <>
      <CalorieProgressBar intakeKcal={intakeKcal} budgetKcal={total} height={compact ? 'h-1.5' : 'h-3'} />

      {/* Q-401 point 4. A budget that grows during the day reads as a bug unless it says why —
          which is literally how this entry started ("why are these values different?"). */}
      {/* BF-87 put a threshold in this line, because the owner had 1,196 steps on screen beside
          "nothing earned from movement" and no way to know that only steps above 3,000 counted.
          BF-88 removed the threshold instead: steps earn from the first one, so the situation that
          sentence explained cannot arise while any steps exist. What is left is the honest
          remaining case — a day with no movement recorded at all. */}
      <p className={`${compact ? 'mt-1' : 'mt-2'} text-[10px] leading-snug text-muted-foreground tabular-nums`}>
        {restingBase.toLocaleString()} base
        {/* Only when there IS one: on `maintain` the delta is 0, and printing "+ 0 for your goal"
            would be noise. That also satisfies BF-99's check that a maintain user sees the same
            number under both wordings. */}
        {goalDelta !== 0 && (
          <> <span className="text-muted-foreground/70">{goalDelta < 0 ? '−' : '+'}</span>{' '}
            {Math.abs(goalDelta).toLocaleString()} for your goal</>
        )}
        {earned > 0
          ? <>
              {' '}<span className="text-muted-foreground/70">+</span> {earned.toLocaleString()} earned from movement
              {parts && <span className="text-muted-foreground/70"> ({parts})</span>}
            </>
          : <> — no movement recorded yet today</>}
      </p>
    </>
  )
})
