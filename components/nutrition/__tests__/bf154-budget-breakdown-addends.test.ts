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
 *
 * ── What BF-154's BUILD half then removed, and why it is a deletion rather than a gap ──
 *
 * Four assertions here read the card's breakdown paragraph — *"Today's budget is 1,294 — 1,294
 * resting rate, +0 moved"* — and that paragraph is gone. It existed inside `{macroGap != null && …}`,
 * whose premise was that the grams and the budget disagree. The grams are now fitted TO the budget,
 * so the gap is zero by construction and the sentence explaining it has nothing to explain.
 *
 * **Nothing about the budget's provenance was lost with it.** `CalorieZoneBar`, rendered by this
 * same card, prints `{base.toLocaleString()} resting rate` on the anchored path — which is the line
 * BF-152's device check is about, and the assertion below still pins it. The deleted paragraph was
 * a second copy of that breakdown wrapped in gap prose, which is the duplication the owner's report
 * opened with: *"There is so many numbers here."*
 *
 * Their arithmetic half is untouched and follows: `budgetProvenance` still has to reconcile, and
 * that is independent of which surface prints it.
 */
describe('the card does not recompute the budget it was handed', () => {
  it('derives every figure from the caller rather than calling budgetProvenance itself', () => {
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
  //
  // With the card's own copy of that breakdown deleted (see the header), the zone bar is the ONE
  // surface naming it, which settles the duplication outright rather than keeping two in agreement.
  it('the surviving surface takes the anchored figure from the provenance base', () => {
    expect(ZONE_BAR).toMatch(/\{base\.toLocaleString\(\)\}\s*resting rate/)
  })

  it('the card prints no second resting figure of its own', () => {
    expect(CARD).not.toMatch(/resting (rate|burn)/)
  })
})
