import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

const ROOT = path.resolve(__dirname, '../../..')
const src = readFileSync(path.join(ROOT, 'components/nutrition/calorie-zone-bar.tsx'), 'utf8')
/** The comments quote the old wording while explaining the bug, so a raw-source match would pass on
 *  prose — the failure mode already on this repo's record. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/**
 * BF-99. The line read `1,264 base`, and `budgetProvenance().base` is
 * `restingBaseKcal + targetNetKcal` — the resting base with the GOAL DELTA already folded in. On the
 * owner's recomp that printed ~200 kcal below his measured RMR, so he went looking for a broken
 * calculation: *"why is my base rate under the 1350 RMR value."* **Every number on the screen
 * reconciled.** The word did not, which is what made it worth fixing rather than explaining.
 */
describe('the line labelled "base" shows the resting base', () => {
  it('does not print budgetProvenance().base as "base"', () => {
    // The specific regression. BF-150 narrowed this: it used to ban DESTRUCTURING `base` at all,
    // which was a proxy for the defect rather than the defect. The anchored path prints `base`
    // legitimately — there it is the user's stored goal and nothing is folded into it — so the ban
    // is now on the only thing that was ever wrong: that value printed beside the word "base".
    expect(code).not.toMatch(/\{base\.toLocaleString\(\)\}\s*base/)
    expect(code).toMatch(/restingBase\.toLocaleString\(\)\}\s*base/)
  })

  it('names the goal delta rather than folding it into the base silently', () => {
    expect(code).toMatch(/goalDelta\s*!==\s*0/)
    expect(code).toMatch(/for your goal/)
  })

  // BF-150. The wording has to follow which branch of `budgetProvenance` ran. On the anchored path
  // there is no resting-base-plus-delta split to name — the goal IS the whole zero-movement budget —
  // so printing "base − goal" there would name two numbers that are not addends of what is on
  // screen, which is BF-99's defect wearing the opposite hat.
  it('switches the wording on whether the budget is anchored to the goal', () => {
    expect(code).toMatch(/anchoredToGoal/)
    expect(code).toMatch(/\{base\.toLocaleString\(\)\}\s*your goal/)
  })
})

describe('the printed figures still reconcile to the budget', () => {
  // What the line now prints, as arithmetic. If these stop summing to the bar's own budget the
  // screen contradicts itself, which is the failure the old label was a symptom of.
  const printed = (b: { restingBaseKcal: number; activeKcal: number; targetNetKcal: number }) =>
    Math.round(b.restingBaseKcal) + Math.round(b.targetNetKcal) + Math.round(b.activeKcal)

  // BF-150's path: the goal replaces both addends, so what is printed is the goal plus movement.
  const printedAnchored = (b: { activeKcal: number; goalKcal: number }) =>
    Math.round(b.goalKcal) + Math.round(b.activeKcal)

  it.each([
    // The owner's reconstructed day: base 1,464, recomp −200, 150 earned → 1,414 budget.
    { restingBaseKcal: 1464, activeKcal: 150, targetNetKcal: -200 },
    { restingBaseKcal: 1464, activeKcal: 0, targetNetKcal: -200 },   // no movement yet
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 300 },  // a surplus goal
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 0 },    // maintain
  ])('sums to budgetProvenance().total for %j', (b) => {
    expect(printed(b)).toBe(budgetProvenance(b).total)
  })

  it.each([
    { restingBaseKcal: 2196, activeKcal: 131, targetNetKcal: -200, goalKcal: 1660 },  // the owner, 2026-09-12
    { restingBaseKcal: 2196, activeKcal: 0, targetNetKcal: -200, goalKcal: 1660 },    // no movement yet
    { restingBaseKcal: 1464, activeKcal: 320, targetNetKcal: 0, goalKcal: 1350 },     // maintain, anchored
  ])('sums to budgetProvenance().total on the anchored path for %j', (b) => {
    expect(printedAnchored(b)).toBe(budgetProvenance(b).total)
  })

  it('a maintain user sees the resting base and nothing else added', () => {
    // BF-99's own verification: on delta 0 the two wordings must show the same number.
    const b = { restingBaseKcal: 1464, activeKcal: 0, targetNetKcal: 0 }
    expect(budgetProvenance(b).base).toBe(Math.round(b.restingBaseKcal))
  })

  it('and a recomp user does NOT — which is the whole bug', () => {
    const b = { restingBaseKcal: 1464, activeKcal: 0, targetNetKcal: -200 }
    expect(budgetProvenance(b).base).toBe(1264)
    expect(budgetProvenance(b).base).not.toBe(Math.round(b.restingBaseKcal))
  })
})
