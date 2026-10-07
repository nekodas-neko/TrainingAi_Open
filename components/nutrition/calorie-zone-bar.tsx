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
  intakeKcal, restingBaseKcal, activeKcal, targetNetKcal, restingRateKcal, deficitKcal, stepCreditKcal,
  workoutKcal, activityKcal, stepsKcal, compact,
}: {
  intakeKcal: number
  restingBaseKcal: number
  activeKcal: number
  targetNetKcal: number
  /** BF-152. The user's resting rate, which anchors the budget when it is known. Null/absent falls
   *  back to the old resting-base-plus-goal-delta budget — see `budgetProvenance`. */
  restingRateKcal?: number | null
  /** #2071. The goal's deficit the budget was built with (payload `deficitKcal`). Absent on a payload
   *  cached before it existed, which `budgetProvenance` then reads on its old terms. */
  deficitKcal?: number | null
  /** #2071. The first 3,000 steps' energy, which the budget takes out of the 20% (payload field). */
  stepCreditKcal?: number | null
  /** The three addends of `activeKcal`, from the service's `activeBreakdown` (BF-87). Scalars, not
   *  the object — `memo` compares shallowly and an object literal at a call site defeats it. */
  workoutKcal: number
  activityKcal: number
  stepsKcal: number
  /** Home's card is dense — tighten the bar. */
  compact?: boolean
}) {
  const { base, earned, total, anchoredToRestingRate, chain } =
    budgetProvenance({ restingBaseKcal, activeKcal, targetNetKcal, restingRateKcal, deficitKcal, stepCreditKcal })
  // #2071. With a floored still day `earned` is only what movement added ABOVE the floor; the chain
  // prints the whole movement, because the chain's own arithmetic is what lifted the day past it.
  const shownEarned = chain != null && chain.floored && !chain.totalFloored ? chain.movement : earned
  const parts = movementSummary({ workoutKcal, activityKcal, stepsKcal })
  // BF-99. On the UNANCHORED path `budgetProvenance().base` is `restingBaseKcal + targetNetKcal` —
  // the resting base with the GOAL DELTA already folded in — and this line called it "base". On a
  // recomp that prints a number ~200 below the owner's measured RMR, so he went looking for a broken
  // calculation: *"why is my base rate under the 1350 RMR value."* Every figure on the screen
  // reconciled; the word did not. The two are separated here rather than in `budgetProvenance`,
  // which is shared and whose `base` is the right thing for a caller that wants one number.
  //
  // BF-150, then BF-152. When the budget is ANCHORED the split does not exist: the anchor is the
  // whole zero-movement budget and no delta is applied to it. Printing "resting base − goal" there
  // would name two numbers that are no longer addends of what is on screen — the same class of
  // defect BF-99 was filed for, so the wording follows the arithmetic rather than the other way
  // round. `base` is used directly, so the line always sums to `total` on both paths.
  //
  // The anchor is now the resting rate, so the word is "resting rate" — which is also the answer to
  // the question BF-99 came from (*"why is my base rate under the 1350 RMR value"*): on this path it
  // IS that number, to within the re-scaling onto today's fat-free mass.
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
        {/* #2071. The owner's own chain — RMR − the goal's deficit + daily living + movement — so
            every term of the number is on screen. Only when the floor set the WHOLE day's number does
            the chain not reach it, and then the line names the floor instead. A still day that is
            floored but lifted clear of it by movement still prints the chain, which is what the total
            is made of (each term rounded, so it can read 1 kcal off the total). */}
        {chain != null
          ? chain.totalFloored
            ? <>{total.toLocaleString()} minimum budget — never below your resting rate</>
            : <>
                {chain.rmr.toLocaleString()} resting rate
                {chain.deficit !== 0 && (
                  <> <span className="text-muted-foreground/70">{chain.deficit > 0 ? '−' : '+'}</span>{' '}
                    {Math.abs(chain.deficit).toLocaleString()} for your goal</>
                )}
                {/* "Daily living" is the 20% LESS the first 3,000 steps (owner, 2026-10-07): movement
                    below counts every step, so those steps are only counted there. */}
                {' '}<span className="text-muted-foreground/70">{chain.dailyLiving < 0 ? '−' : '+'}</span>{' '}
                {Math.abs(chain.dailyLiving).toLocaleString()} daily living
              </>
          : anchoredToRestingRate
          ? <>{base.toLocaleString()} resting rate</>
          : <>
              {restingBase.toLocaleString()} base
              {/* Only when there IS one: on `maintain` the delta is 0, and printing "+ 0 for your
                  goal" would be noise. That also satisfies BF-99's check that a maintain user sees
                  the same number under both wordings. */}
              {goalDelta !== 0 && (
                <> <span className="text-muted-foreground/70">{goalDelta < 0 ? '−' : '+'}</span>{' '}
                  {Math.abs(goalDelta).toLocaleString()} for your goal</>
              )}
            </>}
        {chain?.totalFloored
          ? null
          : shownEarned > 0
          ? <>
              {' '}<span className="text-muted-foreground/70">+</span> {shownEarned.toLocaleString()} earned from movement
              {parts && <span className="text-muted-foreground/70"> ({parts})</span>}
            </>
          : <> — no movement recorded yet today</>}
      </p>
    </>
  )
})
