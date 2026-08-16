import { describe, it, expect } from 'vitest'
import {
  bodyweightLoadFactor,
  bodyweightSetLoadKg,
  BODYWEIGHT_LOAD_DEFAULT,
} from '@trainingai/shared/workout/bodyweight-load'

// Q-13: a bodyweight set logged 0 kg and therefore recorded zero volume, while the same set was
// scored at 82–88% intensity. Volume is now priced at real body weight × a per-exercise fraction.

describe('bodyweightLoadFactor', () => {
  it('prices a fully-suspended movement at the whole body', () => {
    expect(bodyweightLoadFactor('Pull-Up')).toBe(1.0)
    expect(bodyweightLoadFactor('Chin-Up')).toBe(1.0)
  })

  it('prices a leg raise at both legs, not the whole body', () => {
    // Dempster/Winter: each leg ≈ 16.1% of body mass.
    expect(bodyweightLoadFactor('Hanging Leg Raise')).toBe(0.32)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(bodyweightLoadFactor('  pull-up ')).toBe(1.0)
    expect(bodyweightLoadFactor('PULL-UP')).toBe(1.0)
  })

  it('falls back to a documented default for an unlisted movement', () => {
    // A newly-added bodyweight exercise must get a plausible price rather than silently
    // reverting to the zero-volume bug this finding is about.
    expect(bodyweightLoadFactor('Some Novel Calisthenic')).toBe(BODYWEIGHT_LOAD_DEFAULT)
  })

  it('leaves isometric holds unpriced', () => {
    // Their "reps" are seconds, so reps × load is not work in the same currency as every other
    // row — pricing them would corrupt the totals rather than complete them.
    expect(bodyweightLoadFactor('Plank')).toBeNull()
    expect(bodyweightLoadFactor('Side Plank')).toBeNull()
  })
})

describe('bodyweightSetLoadKg', () => {
  it('is body weight × the factor for an unloaded set', () => {
    expect(bodyweightSetLoadKg('Pull-Up', 68.4, 0)).toBeCloseTo(68.4, 5)
    expect(bodyweightSetLoadKg('Hanging Leg Raise', 68.4, 0)).toBeCloseTo(21.888, 3)
  })

  it('adds a weight-belt plate on top', () => {
    expect(bodyweightSetLoadKg('Pull-Up', 68.4, 10)).toBeCloseTo(78.4, 5)
  })

  it('subtracts assistance, which is logged as a negative weight', () => {
    expect(bodyweightSetLoadKg('Pull-Up', 68.4, -20)).toBeCloseTo(48.4, 5)
  })

  it('never returns a negative load', () => {
    expect(bodyweightSetLoadKg('Pull-Up', 68.4, -200)).toBe(0)
  })

  it('falls back to the added load alone when there is no weigh-in', () => {
    // Rather than inventing a body weight: volume then behaves exactly as it did before.
    expect(bodyweightSetLoadKg('Pull-Up', null, 0)).toBe(0)
    expect(bodyweightSetLoadKg('Pull-Up', 0, 15)).toBe(15)
  })

  it('does not price an isometric even with a weigh-in present', () => {
    expect(bodyweightSetLoadKg('Plank', 68.4, 0)).toBe(0)
  })

  it('reproduces the values migration 152 backfills', () => {
    // If the factors or the formula move, the migration's literals are known stale.
    expect(bodyweightSetLoadKg('Pull-Up', 67.6, 0) * 18).toBeCloseTo(1216.8, 2)
    expect(bodyweightSetLoadKg('Hanging Leg Raise', 68.2, 0) * 11).toBeCloseTo(240.06, 2)
  })
})
