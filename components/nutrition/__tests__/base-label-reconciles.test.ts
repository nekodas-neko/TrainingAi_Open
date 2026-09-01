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
    // The specific regression: destructuring `base` and printing it beside the word.
    expect(code).not.toMatch(/const\s*\{[^}]*\bbase\b[^}]*\}\s*=\s*budgetProvenance/)
    expect(code).toMatch(/restingBase\.toLocaleString\(\)\}\s*base/)
  })

  it('names the goal delta rather than folding it into the base silently', () => {
    expect(code).toMatch(/goalDelta\s*!==\s*0/)
    expect(code).toMatch(/for your goal/)
  })
})

describe('the printed figures still reconcile to the budget', () => {
  // What the line now prints, as arithmetic. If these stop summing to the bar's own budget the
  // screen contradicts itself, which is the failure the old label was a symptom of.
  const printed = (b: { restingBaseKcal: number; activeKcal: number; targetNetKcal: number }) =>
    Math.round(b.restingBaseKcal) + Math.round(b.targetNetKcal) + Math.round(b.activeKcal)

  it.each([
    // The owner's reconstructed day: base 1,464, recomp −200, 150 earned → 1,414 budget.
    { restingBaseKcal: 1464, activeKcal: 150, targetNetKcal: -200 },
    { restingBaseKcal: 1464, activeKcal: 0, targetNetKcal: -200 },   // no movement yet
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 300 },  // a surplus goal
    { restingBaseKcal: 1500, activeKcal: 320, targetNetKcal: 0 },    // maintain
  ])('sums to budgetProvenance().total for %j', (b) => {
    expect(printed(b)).toBe(budgetProvenance(b).total)
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
