import { describe, expect, it } from 'vitest'
import { budgetProvenance, scaleMacrosForEarnedKcal } from '@trainingai/shared/nutrition/calorie-balance'
import { macroBudgetGap, MACRO_BUDGET_GAP_KCAL } from '../macro-budget-gap'

/**
 * BF-134. The owner's Nutrition tab, 2026-09-09: macro targets of 150 P / 141 C / 55 F beside a
 * calorie budget of 1,253, on one card, before any movement was recorded.
 */
const STORED = { proteinG: 150, carbsG: 141, fatG: 55 }
/** `restingBase 1,453` with the recomp `−200` folded in, which is what the card prints as the budget. */
const REST_MORNING = { restingBaseKcal: 1453, activeKcal: 0, targetNetKcal: -200 }

describe('the gap the owner saw', () => {
  it('is 406 kcal, and that is the number worth printing', () => {
    const gap = macroBudgetGap(STORED, budgetProvenance(REST_MORNING).total)!
    expect(gap.targetKcal).toBe(1659)
    expect(gap.gapKcal).toBe(406)
  })
})

/**
 * **The entry's own reading of this is wrong, and it is the reason a label is the fix.**
 *
 * BF-134 says the two "converge only once ~406 kcal is earned". They never converge: earning kcal
 * grows the budget by `earned` (`budgetProvenance`) and grows the macro grams by the same `earned`
 * (`scaleMacrosForEarnedKcal` puts it all into carbs and fat in their existing ratio). The addend
 * cancels and a constant offset is left. Waiting for the day to reconcile them is waiting for
 * something that cannot happen — so the card has to say it instead.
 */
describe('the gap is a constant offset, not something the day closes', () => {
  it.each([0, 100, 406, 550, 1200])('is the same 406 with %i kcal earned', (earned) => {
    const scaled = scaleMacrosForEarnedKcal(STORED, earned)
    const budget = budgetProvenance({ ...REST_MORNING, activeKcal: earned }).total
    const gap = macroBudgetGap(scaled, budget)!
    // ±2 kcal: `scaleMacrosForEarnedKcal` rounds each of carbs and fat to whole grams, which is
    // worth up to 4.5 kcal of the earned addend landing on one side of the subtraction.
    expect(gap.gapKcal).toBeGreaterThan(402)
    expect(gap.gapKcal).toBeLessThan(410)
  })

  it('earning exactly the gap does NOT close it', () => {
    const scaled = scaleMacrosForEarnedKcal(STORED, 406)
    const budget = budgetProvenance({ ...REST_MORNING, activeKcal: 406 }).total
    expect(budget).toBe(1659)                       // now equal to the STORED macro total…
    expect(macroBudgetGap(scaled, budget)).not.toBeNull()  // …and the grams have moved too.
  })
})

describe('what it refuses to report', () => {
  it('says nothing when the two agree to within rounding', () => {
    // A maintain user whose stored goal IS resting base + 0: the grams and the budget are one number.
    expect(macroBudgetGap(STORED, 1659)).toBeNull()
    expect(macroBudgetGap(STORED, 1659 - (MACRO_BUDGET_GAP_KCAL - 1))).toBeNull()
    expect(macroBudgetGap(STORED, 1659 - MACRO_BUDGET_GAP_KCAL)).not.toBeNull()
  })

  it('says nothing when a macro target is unset, rather than reading the blank as a shortfall', () => {
    expect(macroBudgetGap({ proteinG: 150, carbsG: 141 }, 1253)).toBeNull()
    expect(macroBudgetGap({ proteinG: 150, carbsG: 141, fatG: undefined }, 1253)).toBeNull()
  })

  it('says nothing without a budget to compare against', () => {
    expect(macroBudgetGap(STORED, null)).toBeNull()
    expect(macroBudgetGap(null, 1253)).toBeNull()
    expect(macroBudgetGap(STORED, Number.NaN)).toBeNull()
  })

  it('is signed, so a goal set below the budget reads as below', () => {
    const gap = macroBudgetGap(STORED, 2000)!
    expect(gap.gapKcal).toBe(-341)
  })
})
