import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => {
  const src = readFileSync(path.join(ROOT, rel), 'utf8')
  // The comments quote the retired formula while explaining the bug, so a raw-source match would
  // pass on prose — the failure mode already on this repo's record.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

const CARD = read('components/nutrition/energy-card.tsx')
const ZONE_BAR = read('components/nutrition/calorie-zone-bar.tsx')

/**
 * BF-154. The card's breakdown sentence printed `restingBaseKcal`, `targetNetKcal` and `activeKcal`
 * — the addends of the formula BF-152 retired — beside a budget the new formula produced. On the
 * owner's screenshot: *"Today's budget is 1,294 — 2,278 resting burn, −200 for your goal, +0
 * moved."* `2,278 − 200 + 0 = 2,078`. One sentence, naming a number and then contradicting it by
 * 784 kcal.
 *
 * **What made it reachable is the shape of the old guard, not the old wording.**
 * `base-label-reconciles.test.ts` reads `calorie-zone-bar.tsx` and nothing else, and bans one
 * destructured value beside one word. This call site never asked `budgetProvenance` anything — it
 * read the balance fields directly — so there was nothing for that guard to catch, on a file it was
 * not looking at.
 */
describe('the breakdown names the addends the budget was actually built from', () => {
  it('prints the provenance base, not the balance field it replaced', () => {
    // The specific regression: `restingBaseKcal` standing alone as the whole zero-movement term.
    expect(CARD).toMatch(/baseKcal\.toLocaleString\(\)\}\s*resting rate/)
    expect(CARD).toMatch(/baseIsRestingRate/)
  })

  it('does not call the provenance base anything but a resting rate', () => {
    // On the anchored path that figure IS the measured RMR re-scaled onto today's fat-free mass.
    // Calling it "base" or "resting burn" re-opens BF-99, whose report was literally *"why is my
    // base rate under the 1350 RMR value"*.
    expect(CARD).not.toMatch(/baseKcal\.toLocaleString\(\)\}\s*(base|resting burn|your goal)/)
  })

  it('keeps the goal delta named on the unanchored path', () => {
    // Where the base folds the delta in, printing it alone is BF-99 in the other direction.
    expect(CARD).toMatch(/for your goal/)
    expect(CARD).toMatch(/targetNetKcal\)\s*!==\s*0/)
  })

  it('derives the base from the caller rather than recomputing it on the card', () => {
    // The card's whole discipline (Q-401, Q-417, Q-323): every number comes from the one call the
    // caller already made. A `budgetProvenance` here would be a second computation of the same
    // quantity, which is what produced two budgets 274 kcal apart on one screen.
    expect(CARD).not.toMatch(/budgetProvenance\s*\(/)
  })
})

describe('what the sentence prints sums to the budget it names', () => {
  // The card's sentence, as arithmetic, on each branch.
  const printedAnchored = (b: { restingBaseKcal: number; activeKcal: number; targetNetKcal: number; restingRateKcal: number }) =>
    budgetProvenance(b).base + Math.round(b.activeKcal)
  const printedUnanchored = (b: { restingBaseKcal: number; activeKcal: number; targetNetKcal: number }) =>
    Math.round(b.restingBaseKcal) + Math.round(b.targetNetKcal) + Math.round(b.activeKcal)

  it('the owner’s reported day reconciles instead of contradicting itself by 784', () => {
    // The screenshot, reconstructed: the estimator's inflated resting base against the resting rate
    // that replaced it as the anchor.
    const b = { restingBaseKcal: 2278, activeKcal: 0, targetNetKcal: -200, restingRateKcal: 1294 }
    const total = budgetProvenance(b).total
    expect(total).toBe(1294)
    // What the card used to print, kept as the regression's own record.
    expect(Math.round(b.restingBaseKcal) + Math.round(b.targetNetKcal) + Math.round(b.activeKcal)).toBe(2078)
    expect(printedAnchored(b)).toBe(total)
  })

  it.each([
    { restingBaseKcal: 2196, activeKcal: 131, targetNetKcal: -200, restingRateKcal: 1342 },
    { restingBaseKcal: 2196, activeKcal: 0, targetNetKcal: -200, restingRateKcal: 1342 },
    { restingBaseKcal: 1464, activeKcal: 320, targetNetKcal: 0, restingRateKcal: 1325 },
    { restingBaseKcal: 1464, activeKcal: 551, targetNetKcal: 300, restingRateKcal: 1325 },
  ])('sums to budgetProvenance().total on the anchored path for %j', (b) => {
    expect(printedAnchored(b)).toBe(budgetProvenance(b).total)
  })

  it.each([
    { restingBaseKcal: 1464, activeKcal: 150, targetNetKcal: -200 },
    { restingBaseKcal: 1464, activeKcal: 0, targetNetKcal: -200 },
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 300 },
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 0 },
  ])('sums to budgetProvenance().total on the unanchored path for %j', (b) => {
    expect(printedUnanchored(b)).toBe(budgetProvenance(b).total)
  })
})

describe('no figure labelled resting appears twice with different values', () => {
  // The second half of the report, and the worse half: the card printed 2,278 as "resting burn" ten
  // lines above the zone bar's 1,294 as "resting rate" — 984 kcal apart, both named resting, one of
  // them the estimator the app has stopped using.
  it('both surfaces take the anchored figure from the same provenance base', () => {
    expect(ZONE_BAR).toMatch(/\{base\.toLocaleString\(\)\}\s*resting rate/)
    expect(CARD).toMatch(/baseKcal\.toLocaleString\(\)\}\s*resting rate/)
  })

  it('the card no longer prints restingBaseKcal on the anchored branch', () => {
    // `restingBaseKcal` survives on the UNANCHORED branch, where it is a real addend, so the check
    // has to be the anchored arm of the ternary rather than the file. Pinned as the whole arm: a
    // slice between two landmarks reaches past the `:` and reads the other branch's text, which is
    // how the first version of this assertion failed against correct code.
    const anchoredArm = CARD.match(/baseIsRestingRate\s*\?([\s\S]*?)\s*:\s*<>/)
    expect(anchoredArm).not.toBeNull()
    expect(anchoredArm![1]).toMatch(/baseKcal/)
    expect(anchoredArm![1]).not.toMatch(/restingBaseKcal|targetNetKcal/)
  })
})
