import { describe, it, expect } from 'vitest'
import { perServing } from '@trainingai/shared/nutrition/scan-totals'

describe('perServing', () => {
  const ing = (weightG: number) => ({
    name: 'x', weightG, caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 10, fatPer100g: 1,
  })

  it('divides the weights and leaves the densities alone', () => {
    const [out] = perServing([ing(480)], 12)
    expect(out.weightG).toBe(40)
    // The densities describe the food, not the portion — scaling them too would divide twice.
    expect(out.caloriesPer100g).toBe(100)
    expect(out.proteinPer100g).toBe(10)
  })

  it('returns the input untouched for a yield of one or less', () => {
    const input = [ing(300)]
    expect(perServing(input, 1)).toBe(input)
    expect(perServing(input, 0)).toBe(input)
    expect(perServing(input, -3)).toBe(input)
  })

  it('keeps one decimal place rather than rounding a small ingredient to nothing', () => {
    expect(perServing([ing(5)], 8)[0].weightG).toBe(0.6)
  })
})
