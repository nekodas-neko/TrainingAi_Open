import { describe, it, expect } from 'vitest'
import { calculateSteps } from '../treadmill-utils'

describe('calculateSteps', () => {
  it('calculates steps for 180cm person over 5km', () => {
    // stride = 1.80 * 0.415 = 0.747m, steps = 5000 / 0.747 ≈ 6693
    expect(calculateSteps(5, 180)).toBe(6693)
  })

  it('calculates steps for 165cm person over 3km', () => {
    // stride = 1.65 * 0.415 = 0.68475m, steps = 3000 / 0.68475 ≈ 4381
    expect(calculateSteps(3, 165)).toBe(4381)
  })

  it('returns 0 for zero distance', () => {
    expect(calculateSteps(0, 180)).toBe(0)
  })
})
