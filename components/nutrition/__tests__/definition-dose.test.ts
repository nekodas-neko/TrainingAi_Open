import { describe, expect, it } from 'vitest'
import { definitionDose, hasFreeTextBesideAmount } from '../definition-dose'

describe('definitionDose — OR-104', () => {
  it('prefers the structured amount, which is the one the app computes with', () => {
    // The live Retatrutide row: 0.5 mg structured, "10mg" free text (the vial strength).
    expect(definitionDose({ defaultAmount: 0.5, unit: 'mg', dose: '10mg' })).toBe('0.5 mg')
  })

  it('falls back to the free text when there is no structured amount', () => {
    expect(definitionDose({ defaultAmount: null, unit: null, dose: '1 capsule' })).toBe('1 capsule')
  })

  it('renders an amount with no unit rather than a dangling space', () => {
    expect(definitionDose({ defaultAmount: 2, unit: null, dose: null })).toBe('2')
  })

  it('treats zero as a real amount, not as absent', () => {
    expect(definitionDose({ defaultAmount: 0, unit: 'mg', dose: 'x' })).toBe('0 mg')
  })

  it('has nothing to say when the definition carries neither', () => {
    expect(definitionDose({ defaultAmount: null, unit: 'mg', dose: '   ' })).toBeNull()
    expect(definitionDose({ dose: null })).toBeNull()
  })
})

describe('hasFreeTextBesideAmount — OR-104', () => {
  it('flags the state that can hold two answers to one question', () => {
    expect(hasFreeTextBesideAmount({ defaultAmount: 0.5, unit: 'mg', dose: '10mg' })).toBe(true)
  })

  it('does not flag free text alone, which is the pre-BF-112 shape and still valid', () => {
    expect(hasFreeTextBesideAmount({ defaultAmount: null, dose: '1 scoop' })).toBe(false)
  })

  it('does not flag a structured amount alone', () => {
    expect(hasFreeTextBesideAmount({ defaultAmount: 5, unit: 'g', dose: null })).toBe(false)
    expect(hasFreeTextBesideAmount({ defaultAmount: 5, unit: 'g', dose: '  ' })).toBe(false)
  })
})
