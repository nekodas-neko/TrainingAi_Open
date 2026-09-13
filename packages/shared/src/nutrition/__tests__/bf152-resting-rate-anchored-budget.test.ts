import { describe, it, expect } from 'vitest'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { cunninghamBmr, personalRmr } from '@trainingai/shared/health/body-composition'

// The owner's real figures, 2026-09-13: calibrated resting base 2,196, goal delta −200, earned 131,
// resting rate 1,342 (his 1,325 measured on 2026-08-27 re-scaled onto today's 52.3 kg of fat-free
// mass). Verified against production.
const REAL = { restingBaseKcal: 2196, activeKcal: 131, targetNetKcal: -200 }

describe('BF-152 against the owner\'s own numbers', () => {
  it('reproduces the 2,127 the estimator-anchored budget showed', () => {
    expect(budgetProvenance(REAL))
      .toMatchObject({ base: 1996, earned: 131, total: 2127, anchoredToRestingRate: false })
  })

  it('anchors to the resting rate after the change', () => {
    expect(budgetProvenance({ ...REAL, restingRateKcal: 1342 }))
      .toMatchObject({ base: 1342, earned: 131, total: 1473, anchoredToRestingRate: true })
  })

  // The owner asked for *"start at 1350 … move throughout the day to 1600"*. The start is his resting
  // rate; the climb is the earned half, which needed no change — this is that day as one expression.
  it('starts at the resting rate on a still day and climbs with movement', () => {
    const still = budgetProvenance({ ...REAL, activeKcal: 0, restingRateKcal: 1342 })
    expect(still.total).toBe(1342)
    const moved = budgetProvenance({ ...REAL, activeKcal: 300, restingRateKcal: 1342 })
    expect(moved.total).toBe(1642)
    expect(moved.base).toBe(still.base)
  })

  it('does not apply the goal delta on top of the resting rate', () => {
    const a = budgetProvenance({ ...REAL, restingRateKcal: 1342 })
    const b = budgetProvenance({ ...REAL, targetNetKcal: -500, restingRateKcal: 1342 })
    expect(a.total).toBe(b.total)
  })

  // The anchor is a re-scaling, not the stored measurement: the whole reason BF-150's typed-in number
  // was the wrong anchor is that the body moves under it. 1.9 kg of loss moves this by 18 kcal.
  it('tracks a changing body, which a stored target cannot', () => {
    const atTest = personalRmr({ rmrKcal: 1325, ffmKgAtTest: 51.5 }, 51.5)!
    const today = personalRmr({ rmrKcal: 1325, ffmKgAtTest: 51.5 }, 52.3)!
    expect(Math.round(atTest)).toBe(1325)
    expect(Math.round(today)).toBe(1342)
    expect(budgetProvenance({ ...REAL, restingRateKcal: today }).base)
      .not.toBe(budgetProvenance({ ...REAL, restingRateKcal: atTest }).base)
  })

  // `bmr × 1.2` is the classic sedentary multiplier and lands on the owner's *"1600"* — the entry's
  // one overrulable line chose to credit that overhead through observed movement instead. Pinning it
  // here so a later session changing its mind sees what the multiplier would have produced.
  it('is the resting rate itself, not a sedentary multiple of it', () => {
    const p = budgetProvenance({ ...REAL, activeKcal: 0, restingRateKcal: 1342 })
    expect(p.base).toBe(1342)
    expect(p.base).not.toBe(Math.round(1342 * 1.2))
  })

  for (const bad of [null, undefined, 0, -100, NaN, Infinity]) {
    it(`falls back to the old budget for restingRateKcal=${String(bad)}`, () => {
      expect(budgetProvenance({ ...REAL, restingRateKcal: bad as number }).total).toBe(2127)
    })
  }

  it('keeps the Cunningham constant it re-scales through in one place', () => {
    expect(cunninghamBmr(51.5)).toBeCloseTo(1482.4, 1)
  })
})
