// PS-33: the two scale ingest routes filled a missing height with 170 cm and a missing date of
// birth with 35 years, then stored the resulting body fat and metabolic age under source
// `scale_ble` as measured readings — live, 22 % body fat and metabolic age 37 on a profile with no
// date of birth. Every one of those inputs moves the answer, so a default here does not degrade
// the reading, it invents one that nothing downstream can tell apart from a real one.
import { describe, it, expect } from 'vitest'
import { resolveCompositionInputs, computeBodyComposition } from '../composition'

const COMPLETE = { heightCm: 158, dateOfBirth: '1993-01-01', sex: 'male' }
const AGE = 33

describe('resolveCompositionInputs', () => {
  it('passes a complete profile through unchanged', () => {
    expect(resolveCompositionInputs(COMPLETE, AGE)).toEqual({ heightCm: 158, ageYears: AGE, sex: 'male' })
  })

  it('declines when height is missing', () => {
    expect(resolveCompositionInputs({ ...COMPLETE, heightCm: null }, AGE)).toBeNull()
    expect(resolveCompositionInputs({ ...COMPLETE, heightCm: undefined }, AGE)).toBeNull()
  })

  it('declines when the age could not be derived', () => {
    // `ageFromDob` returns null for a missing or unparseable date of birth; the caller passes that
    // straight in, so this is the no-DOB case.
    expect(resolveCompositionInputs(COMPLETE, null)).toBeNull()
  })

  it('declines when sex is missing', () => {
    // Named in neither the entry nor the original defaults, and the same defect: the estimator
    // reads `sex === 'male'`, so an absent value quietly applies the female terms.
    expect(resolveCompositionInputs({ ...COMPLETE, sex: null }, AGE)).toBeNull()
    expect(resolveCompositionInputs({ ...COMPLETE, sex: '' }, AGE)).toBeNull()
  })

  it('declines for an absent user rather than assuming a shape', () => {
    expect(resolveCompositionInputs(null, AGE)).toBeNull()
    expect(resolveCompositionInputs(undefined, AGE)).toBeNull()
  })
})

describe('why the defaults were not harmless', () => {
  it('the old placeholders produce a materially different reading from the real profile', () => {
    // 170 cm / 35 y (the removed defaults) against the owner's real 158 cm / 33 y, same weight and
    // impedance. If these agreed, storing the placeholder answer would be a rounding question
    // rather than a fabrication.
    const real = computeBodyComposition({ weightKg: 72.4, impedanceOhms: 515, ...COMPLETE, ageYears: AGE, heightCm: 158 })
    const placeholder = computeBodyComposition({ weightKg: 72.4, impedanceOhms: 515, heightCm: 170, ageYears: 35, sex: 'male' })

    expect(Math.abs(real.bodyFatPct - placeholder.bodyFatPct)).toBeGreaterThan(1)
    expect(real.bmrKcal).not.toBe(placeholder.bmrKcal)
  })

  it('a missing sex alone changes the answer', () => {
    const male = computeBodyComposition({ weightKg: 72.4, impedanceOhms: 515, heightCm: 158, ageYears: AGE, sex: 'male' })
    const absent = computeBodyComposition({ weightKg: 72.4, impedanceOhms: 515, heightCm: 158, ageYears: AGE, sex: null })

    expect(Math.abs(male.bodyFatPct - absent.bodyFatPct)).toBeGreaterThan(5)
  })
})
