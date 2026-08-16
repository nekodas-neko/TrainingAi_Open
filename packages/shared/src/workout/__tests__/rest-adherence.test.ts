import { describe, it, expect } from 'vitest'
import { restAdherencePct } from '@trainingai/shared/workout/rest-adherence'

describe('restAdherencePct', () => {
  it('averages actual/prescribed over sets with both values', () => {
    // 90/90 = 1.0, 45/90 = 0.5 → mean 0.75 → 75%
    expect(restAdherencePct([
      { actualRestSec: 90, prescribedRestSec: 90 },
      { actualRestSec: 45, prescribedRestSec: 90 },
      { actualRestSec: null, prescribedRestSec: 90 },   // skipped
      { actualRestSec: 120, prescribedRestSec: null },  // skipped
    ])).toBe(75)
  })
  it('returns null when no set has both values', () => {
    expect(restAdherencePct([{ actualRestSec: null, prescribedRestSec: 90 }])).toBeNull()
    expect(restAdherencePct([])).toBeNull()
  })
  it('caps a single wildly long rest so one forgotten timer cannot dominate', () => {
    // 900/90 capped at 3.0 → (3.0 + 1.0) / 2 = 2.0 → 200%
    expect(restAdherencePct([
      { actualRestSec: 900, prescribedRestSec: 90 },
      { actualRestSec: 90, prescribedRestSec: 90 },
    ])).toBe(200)
  })
})
