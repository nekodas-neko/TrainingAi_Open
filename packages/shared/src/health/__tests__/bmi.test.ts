import { describe, expect, it } from 'vitest'
import { bmiClassification } from '../bmi'

const base = { weightKg: 80, heightCm: 180, bodyFatPct: null, sex: 'male' as string | null }

describe('bmiClassification', () => {
  it('has no BMI without both weight and height', () => {
    expect(bmiClassification({ ...base, weightKg: null })).toEqual({ bmi: null, bmiUsesBf: false, bmiLabel: null })
    expect(bmiClassification({ ...base, heightCm: 0 }).bmi).toBeNull()
  })
  it('uses the standard bands without body fat', () => {
    const r = bmiClassification(base)
    expect(r.bmi).toBeCloseTo(24.69, 1)
    expect(r.bmiLabel).toBe('Normal')
    expect(r.bmiUsesBf).toBe(false)
    expect(bmiClassification({ ...base, weightKg: 50 }).bmiLabel).toBe('Underweight')
    expect(bmiClassification({ ...base, weightKg: 90 }).bmiLabel).toBe('Overweight')
    expect(bmiClassification({ ...base, weightKg: 110 }).bmiLabel).toBe('Obese')
  })
  it('classifies by body fat when there is a reading, by sex', () => {
    expect(bmiClassification({ ...base, bodyFatPct: 12 })).toMatchObject({ bmiUsesBf: true, bmiLabel: 'Athletic' })
    expect(bmiClassification({ ...base, bodyFatPct: 5 }).bmiLabel).toBe('Essential fat')
    expect(bmiClassification({ ...base, bodyFatPct: 30 }).bmiLabel).toBe('High fat')
    expect(bmiClassification({ ...base, bodyFatPct: 22, sex: 'female' }).bmiLabel).toBe('Fitness')
    expect(bmiClassification({ ...base, bodyFatPct: 22, sex: 'male' }).bmiLabel).toBe('Average')
  })
})
