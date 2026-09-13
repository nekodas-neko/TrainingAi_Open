import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

/**
 * BF-142 — the sentence the card prints beside that gap, which was false in two ways.
 *
 * Owner, third report in this family: *"calories still not right"*. The card said *"The grams come
 * from your stored daily goal"* four lines below its own prop comment saying they are the
 * **effective** targets — already earned-scaled. And it explained the gap as goal-versus-budget
 * **"with the movement recorded today"**, which is the one reason this module rules out: movement
 * is in both addends and cancels, so a reader who believes that sentence waits for a gap that never
 * closes.
 *
 * This is a source guard rather than a render assertion because the defect was **the words**, not
 * the arithmetic — the printed numbers checked out to the kcal. The harness covers that the
 * replacement renders; these three assertions cover that the retracted claims cannot come back.
 */
describe('the sentence on the card (BF-142)', () => {
  const card = readFileSync(path.join(__dirname, '../energy-card.tsx'), 'utf8')

  it('no longer claims the grams are the stored goal', () => {
    expect(card).not.toMatch(/grams come from your stored daily goal/i)
    // What they actually are: the stored goal scaled by what has been earned.
    expect(card).toMatch(/scaled up by the same movement/i)
  })

  it('no longer offers movement as what separates the two numbers', () => {
    expect(card, 'movement is in both addends and cancels').not.toMatch(/the movement recorded today/i)
    expect(card).toMatch(/moving more raises both numbers/i)
  })

  it('names the stored goal beside the computed budget', () => {
    // The owner's complaint was that not one number on the card was the number he chose.
    expect(card).toMatch(/storedGoalCalories/)
    expect(card).toMatch(/Your stored goal is/)
    expect(card).toMatch(/resting burn/)
  })

  it('does not hardcode a gap figure anywhere', () => {
    // The docstring above used to pin 406 "at every hour of every day". Measured 2026-09-11 it was
    // 295 the other way — the sign flipped and the resting base had risen ~700 kcal. A restated
    // constant inherits a number that has already moved.
    const gapModule = readFileSync(path.join(__dirname, '../macro-budget-gap.ts'), 'utf8')
    const asCurrentFact = /\b406 kcal\b(?![^\n]*(?:earlier version|BF-142|used to))/
    expect(gapModule).not.toMatch(asCurrentFact)
  })
})
