'use client'

import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import { restingRateWording } from '@trainingai/shared/nutrition/resting-rate-source'
import { formatDayShort } from '@trainingai/shared/date-utils'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

/**
 * The ⓘ panel's explanation of the energy numbers, rendered by both surfaces that show them.
 *
 * **One copy, because there were two and they had already drifted.** `energy-card.tsx` and
 * `calorie-balance-bar.tsx` each held the same three paragraphs inline, and the card had grown a
 * fourth (BF-134's) that the bar never got — so the same figure came with different explanations
 * depending on which screen you opened it from. `calorie-zone-bar.tsx`'s own comment names this
 * class: *"two hand-maintained copies of this scale is the drift class that put two different
 * calorie budgets on one screen."* Adding LA-102's sentence to two files would have made it three
 * paragraphs out of step instead of one.
 */
export function EnergyExplainer({ data }: { data: EnergyBalanceResponse }) {
  const b = data.balance!
  const m = data.maintenance
  const rate = restingRateWording(b.restingRateSource, b.restingRateMeasuredOn, formatDayShort)
  // #2071. The same call every budget surface makes, so the chain printed here is the budget's own.
  const budget = budgetProvenance(b)
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3">
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Calories out</span> = your resting burn
        ({b.restingBaseKcal.toLocaleString()} kcal) plus measured movement ({b.activeKcal.toLocaleString()} kcal
        from workouts, activities, and every step you take).
      </p>

      {/* BF-138 ①. The chain from the number he knows to the number on screen. He knows his own
          measured RMR and saw a different base, and reasonably suspected an error — the steps
          between were sound and stated nowhere. Endpoints only: the multiplier and the step credit
          are intermediates this payload does not carry, and inventing them here would be a second
          implementation of a calculation this entry forbids touching. */}
      {b.restingRateKcal != null && b.restingRateKcal !== b.restingBaseKcal && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          That resting burn starts from {rate.label} of{' '}
          <span className="font-semibold text-foreground">{b.restingRateKcal.toLocaleString()} kcal</span>
          {rate.note ? ` (${rate.note})` : ''},
          scaled up for simply being awake and about, then reduced again by the everyday walking that
          scaling already assumed — which is what leaves{' '}
          <span className="font-semibold text-foreground">{b.restingBaseKcal.toLocaleString()} kcal</span>{' '}
          for your movement to be added to.
        </p>
      )}

      {/* BF-134's reported symptom. The owner read `1,453 base − 200 for your goal` as two
          deductions, because one of them is: the resting burn already has habitual movement
          removed. That subtraction is real, it is not the goal delta, and nothing on the card
          named it. The mechanism differs by path — the formula base holds back the energy of
          the first steps, the calibrated base subtracts the window's average movement — so this
          says the thing true of both rather than a figure only one of them produces. */}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Your <span className="font-semibold text-foreground">resting burn</span> already has your
        habitual daily movement taken out of it, which is why it sits below your maintenance. That
        is what lets the movement you record be added once rather than counted twice — it is not a
        second deduction for your goal.
      </p>

      {/* #2071 replaced LA-102's paragraph here. LA-102 said digestion and everyday living were "not
          in the base at all", which was true of BF-152's bare-resting-rate budget. The owner's final
          spec puts them in — the existing 20% (`SEDENTARY_MULTIPLIER − 1`) — and takes the goal's
          deficit off, so this names the chain the provenance line under the bar prints. */}
      {budget.chain != null && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Today&apos;s budget</span> is your resting
          rate ({budget.chain.rmr.toLocaleString()} kcal)
          {budget.chain.deficit > 0 && <>, less {budget.chain.deficit.toLocaleString()} kcal for your goal</>}
          {budget.chain.deficit < 0 && <>, plus {Math.abs(budget.chain.deficit).toLocaleString()} kcal for your goal</>}
          , plus {budget.chain.dailyLiving.toLocaleString()} kcal for daily living and digesting food
          (a fifth of your resting rate, {budget.chain.metabolicBurn.toLocaleString()} kcal, less the{' '}
          {budget.chain.stepCredit.toLocaleString()} kcal your first 3,000 steps are worth — your
          movement counts every step, so those are counted there), plus your movement as it is
          measured — {budget.total.toLocaleString()} kcal so far. The goal part comes from your
          {b.deficitWeightSource === 'trend' ? ' 30-day trend weight' : ' latest weigh-in'}
          {b.deficitWeightKg != null ? ` (${b.deficitWeightKg} kg)` : ''} and your goal weight, and
          shrinks as you near it; the budget never drops below your resting rate or 1,200 kcal,
          whichever is higher.
        </p>
      )}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">On target</span> means you ate within 150
        kcal of today&apos;s budget. Your net against the calories out above is
        {' '}{b.netKcal >= 0 ? '+' : ''}{b.netKcal.toLocaleString()} kcal, and sustaining today&apos;s net works out to {b.projectedWeeklyKg >= 0 ? '+' : ''}{b.projectedWeeklyKg} kg/week.
      </p>

      {/* BF-138 ② printed "Why two numbers" here: the saved goal beside today's budget. #2071 retired
          the typed goal as a displayed budget, so there is one number and nothing to reconcile. */}
      {/* BF-138 ③. The most useful sentence available is not any estimate. A flat weight across a
          long logged window is measured; every figure above it is derived, and presenting them as
          equally solid is what made the derived ones look authoritative. */}
      {m != null && m.daysLogged >= 14 && m.weightRateKgPerWeek != null && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">What is actually measured:</span> across{' '}
          {m.daysLogged} logged days your weight moved{' '}
          {Math.abs(m.weightRateKgPerWeek) < 0.1
            ? <>barely at all</>
            : <>{m.weightRateKgPerWeek > 0 ? 'up' : 'down'} about {Math.abs(m.weightRateKgPerWeek)} kg a week</>}
          . That is an observation; everything above it is an estimate.
        </p>
      )}

      {m?.source === 'calibrated' && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Maintenance is measured from your own logged intake against your weight trend, not a
          formula — it re-calibrates as you log.
        </p>
      )}
    </div>
  )
}
