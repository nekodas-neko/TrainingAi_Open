'use client'

import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

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
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3">
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Calories out</span> = your resting burn
        ({b.restingBaseKcal.toLocaleString()} kcal) plus measured movement ({b.activeKcal.toLocaleString()} kcal
        from workouts, activities, and every step you take).
      </p>

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

      {/* LA-102. The owner, on the anchored budget: *"1350 doesnt count some basic metabolic
          needs".* He is right, and BF-152 chose not to model either omission rather than
          overlooking them — a multiplier ASSERTS the overhead happened where the step credit
          OBSERVES it, and treating intake-linked digestion as an earned credit makes the budget
          grow as you eat. So the fix is to say what the base leaves out, not to inflate it.

          Deliberately a separate paragraph from the one above, which is about not double-counting
          movement that IS eventually added. These two are never added by anything. */}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Two things are <span className="font-semibold text-foreground">not in the base at all</span>:
        the energy it takes to digest what you eat, and small everyday movement your phone cannot
        count — standing, fidgeting, housework. Both are real and neither is estimated here, so on a
        still day your true burn runs a little above what this shows. Movement is added only as it is
        measured.
      </p>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">On target</span> means your net
        ({b.netKcal >= 0 ? '+' : ''}{b.netKcal.toLocaleString()}) is within 150 kcal of the
        {' '}{b.targetNetKcal >= 0 ? '+' : ''}{b.targetNetKcal.toLocaleString()} kcal/day your goal calls for.
        Sustaining today&apos;s net works out to {b.projectedWeeklyKg >= 0 ? '+' : ''}{b.projectedWeeklyKg} kg/week.
      </p>

      {m?.source === 'calibrated' && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Maintenance is measured from your own logged intake against your weight trend, not a
          formula — it re-calibrates as you log.
        </p>
      )}
    </div>
  )
}
