import { describe, it, expect } from 'vitest'
import { bodyComposition, cunninghamBmr, bodyCompSnapshot } from '../body-composition'

describe('bodyComposition', () => {
  it('derives fat mass, lean mass, and Cunningham BMR', () => {
    const c = bodyComposition(80, 20)!
    expect(c.fatMassKg).toBeCloseTo(16, 6) // 80 * 0.20
    expect(c.ffmKg).toBeCloseTo(64, 6) // 80 - 16
    expect(c.bmrKcal).toBeCloseTo(64 * 21.6 + 370, 6) // 1752.4
  })

  it('0% body fat → all mass is lean', () => {
    const c = bodyComposition(70, 0)!
    expect(c.fatMassKg).toBe(0)
    expect(c.ffmKg).toBe(70)
    expect(c.bmrKcal).toBeCloseTo(70 * 21.6 + 370, 6)
  })

  it('returns null for missing/implausible inputs (never fabricates)', () => {
    expect(bodyComposition(null, 20)).toBeNull()
    expect(bodyComposition(80, null)).toBeNull()
    expect(bodyComposition(undefined, undefined)).toBeNull()
    expect(bodyComposition(0, 20)).toBeNull()
    expect(bodyComposition(-5, 20)).toBeNull()
    expect(bodyComposition(80, -1)).toBeNull()
    expect(bodyComposition(80, 101)).toBeNull()
    expect(bodyComposition(NaN, 20)).toBeNull()
  })
})

describe('cunninghamBmr', () => {
  it('is ffm·21.6 + 370', () => {
    expect(cunninghamBmr(64)).toBeCloseTo(64 * 21.6 + 370, 6)
    expect(cunninghamBmr(0)).toBe(370)
  })
})

describe('bodyCompSnapshot', () => {
  it('rounds the completed-form JSONB snapshot (§6.1 shape)', () => {
    const snap = bodyCompSnapshot(80, 20)!
    expect(snap).toEqual({
      weight_kg: 80,
      body_fat_pct: 20,
      fat_mass_kg: 16, // 80·0.20
      ffm_kg: 64, // 80−16
      bmr_kcal: 1752, // round(64·21.6+370 = 1752.4)
      source: 'derived',
    })
  })

  it('is null when either input is missing', () => {
    expect(bodyCompSnapshot(80, null)).toBeNull()
    expect(bodyCompSnapshot(null, 20)).toBeNull()
    expect(bodyCompSnapshot(0, 20)).toBeNull()
  })
})
