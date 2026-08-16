import { describe, it, expect } from 'vitest'
import { splitMacrosAcrossMeals } from '../meal-split'

/**
 * Reordering plan meals.
 *
 * The route validates that an `order` is a permutation and then re-splits; this pins the half that
 * makes reordering *worth* doing — that a meal's macro target genuinely depends on where it sits
 * relative to training, so moving a meal has to move its numbers too.
 */

const DAY = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 }

function isPermutation(order: number[], count: number): boolean {
  const expected = [...Array(count).keys()]
  const got = [...order].sort((a, b) => a - b)
  return got.length === expected.length && got.every((v, i) => v === expected[i])
}

describe('order validation', () => {
  it('accepts a genuine permutation', () => {
    expect(isPermutation([2, 0, 1], 3)).toBe(true)
    expect(isPermutation([0, 1, 2], 3)).toBe(true)
  })

  // Both of these would duplicate one meal and silently drop another.
  it('rejects a duplicate or a wrong length', () => {
    expect(isPermutation([0, 0, 1], 3)).toBe(false)
    expect(isPermutation([0, 1], 3)).toBe(false)
    expect(isPermutation([0, 1, 2, 3], 3)).toBe(false)
  })

  it('rejects an out-of-range slot', () => {
    expect(isPermutation([0, 1, 5], 3)).toBe(false)
  })
})

describe('why a reorder must re-split rather than swap labels', () => {
  it('gives different carb targets to different slots when training has a time', () => {
    const slots = splitMacrosAcrossMeals(DAY, 4, { trainingTime: '17:00' })
    const carbs = slots.map(s => s.carbsG)
    // If every slot got the same share there would be nothing to re-split and a swap would do.
    expect(new Set(carbs).size).toBeGreaterThan(1)
  })

  it('keeps the day exactly whole however the meals are arranged', () => {
    for (const n of [3, 4, 5]) {
      const slots = splitMacrosAcrossMeals(DAY, n, { trainingTime: '17:00' })
      const sum = (k: 'proteinG' | 'carbsG' | 'fatG') =>
        Math.round(slots.reduce((a, s) => a + s[k], 0))
      expect(sum('proteinG')).toBe(DAY.proteinG)
      expect(sum('carbsG')).toBe(DAY.carbsG)
      expect(sum('fatG')).toBe(DAY.fatG)
    }
  })

  // The peri-workout weighting keys off meal TIMES, so the same meal in a different slot really
  // does get a different number — which is the whole reason the route re-splits.
  it('moves the carb-heavy slot when the training time moves', () => {
    const early = splitMacrosAcrossMeals(DAY, 4, { trainingTime: '07:00' })
    const late = splitMacrosAcrossMeals(DAY, 4, { trainingTime: '19:00' })
    const peak = (s: typeof early) => s.indexOf([...s].sort((a, b) => b.carbsG - a.carbsG)[0])
    expect(peak(early)).not.toBe(peak(late))
  })
})
