import { describe, it, expect } from 'vitest'
import { deriveVo2Max, jacksonNonExercise, PA_R_BY_ACTIVITY } from '../vo2max'

describe('deriveVo2Max', () => {
  it('Uth–Sørensen: 15.3 × HRmax/HRrest when RHR + HRmax present', () => {
    // HRmax 185 (measured), RHR 50 → 15.3 * 185/50 = 56.61
    const r = deriveVo2Max({ restingHr: 50, measuredMaxHr: 185, age: 35, sex: 'male', weightKg: 80, heightCm: 180, activityLevel: 'moderate' })
    expect(r.method).toBe('uth-sorensen')
    expect(r.value).toBeCloseTo(56.6, 1)
  })

  it('falls back to age-predicted HRmax (220 − age) when no measured max', () => {
    const r = deriveVo2Max({ restingHr: 55, measuredMaxHr: null, age: 40, sex: 'female', weightKg: 65, heightCm: 165, activityLevel: 'light' })
    expect(r.method).toBe('uth-sorensen') // 15.3 * 180/55 = 50.07
    expect(r.value).toBeCloseTo(50.1, 1)
  })

  it('falls back to Jackson NEX when RHR is missing', () => {
    const r = deriveVo2Max({ restingHr: null, measuredMaxHr: null, age: 30, sex: 'male', weightKg: 78, heightCm: 178, activityLevel: 'active' })
    expect(r.method).toBe('jackson-nex')
    expect(r.value).toBeGreaterThan(30)
    expect(r.value).toBeLessThan(70)
  })

  it('returns null when neither model has enough inputs (age missing)', () => {
    expect(deriveVo2Max({ restingHr: null, measuredMaxHr: null, age: null, sex: null, weightKg: null, heightCm: null, activityLevel: null }).value).toBeNull()
  })

  it('clamps into the OTS-valid [10,100] range', () => {
    const r = deriveVo2Max({ restingHr: 30, measuredMaxHr: 210, age: 20, sex: 'male', weightKg: 70, heightCm: 180, activityLevel: 'extra_active' })
    expect(r.value! <= 100).toBe(true) // 15.3*210/30 = 107.1 → clamped 100
    expect(r.value).toBe(100)
  })
})

describe('jacksonNonExercise', () => {
  it('matches the published constants (male, PA-R for activity)', () => {
    // 56.363 + 1.921*PA_R - 0.381*age - 0.754*BMI + 10.987*sexMale
    const paR = PA_R_BY_ACTIVITY.moderate
    const bmi = 80 / (1.8 * 1.8)
    const expected = 56.363 + 1.921 * paR - 0.381 * 35 - 0.754 * bmi + 10.987 * 1
    expect(jacksonNonExercise({ age: 35, sex: 'male', bmi, activityLevel: 'moderate' })).toBeCloseTo(expected, 4)
  })
})
