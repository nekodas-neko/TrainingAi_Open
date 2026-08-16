import { describe, it, expect } from 'vitest'
import {
  computeBodyComposition, hasValidImpedance, MIN_VALID_IMPEDANCE_OHMS, SCALE_WEIGHT_ANOMALY_PCT,
} from '@/lib/scale-ble/composition'

describe('computeBodyComposition', () => {
  const base = { weightKg: 70.95, impedanceOhms: 504, heightCm: 178, ageYears: 30, sex: 'male' }

  it('returns all fields within plausible physiological ranges for a real captured reading', () => {
    const c = computeBodyComposition(base)
    expect(c.bodyFatPct).toBeGreaterThan(3)
    expect(c.bodyFatPct).toBeLessThan(60)
    expect(c.fatFreeMassKg).toBeGreaterThan(0)
    expect(c.fatFreeMassKg).toBeLessThan(base.weightKg)
    expect(c.bodyWaterPct).toBeGreaterThan(35)
    expect(c.bodyWaterPct).toBeLessThan(75)
    expect(c.skeletalMusclePct).toBeGreaterThan(10)
    expect(c.boneMassKg).toBeGreaterThan(1)
    expect(c.boneMassKg).toBeLessThan(6)
    expect(c.bmrKcal).toBeGreaterThan(800)
    expect(c.bmrKcal).toBeLessThan(3000)
    expect(c.metabolicAge).toBeGreaterThanOrEqual(15)
    expect(c.metabolicAge).toBeLessThanOrEqual(80)
  })

  it('fat-free mass + fat mass reconstructs total weight', () => {
    const c = computeBodyComposition(base)
    const fatMassKg = base.weightKg * (c.bodyFatPct / 100)
    expect(fatMassKg + c.fatFreeMassKg).toBeCloseTo(base.weightKg, 1)
  })

  it('higher body fat % at the same weight/height yields a higher BMI-driven estimate for an older age', () => {
    const younger = computeBodyComposition({ ...base, ageYears: 25 })
    const older = computeBodyComposition({ ...base, ageYears: 55 })
    expect(older.bodyFatPct).toBeGreaterThan(younger.bodyFatPct)
  })

  it('lower impedance (more conductive, typically leaner) reduces the body-fat estimate', () => {
    const lowImpedance = computeBodyComposition({ ...base, impedanceOhms: 400 })
    const highImpedance = computeBodyComposition({ ...base, impedanceOhms: 650 })
    expect(lowImpedance.bodyFatPct).toBeLessThan(highImpedance.bodyFatPct)
  })

  it('male vs female sex changes the estimate', () => {
    const male = computeBodyComposition({ ...base, sex: 'male' })
    const female = computeBodyComposition({ ...base, sex: 'female' })
    expect(male.bodyFatPct).not.toBeCloseTo(female.bodyFatPct, 0)
  })

  it('BMR uses Mifflin-St Jeor and is sane for a real adult', () => {
    const c = computeBodyComposition(base)
    // 10*70.95 + 6.25*178 - 5*30 + 5 = 709.5 + 1112.5 - 150 + 5 = 1677
    expect(c.bmrKcal).toBe(1677)
  })

  it('anomaly threshold constant is 15%', () => {
    expect(SCALE_WEIGHT_ANOMALY_PCT).toBe(0.15)
  })

  it('rejects a no-contact impedance reading (socks/dry feet) as invalid', () => {
    // Real captured incident: socks broke foot-plate contact and the scale reported 0/0 rather
    // than omitting the packet — feeding that straight into the formula floors bodyFatPct at 3%.
    expect(hasValidImpedance(0)).toBe(false)
    expect(hasValidImpedance(MIN_VALID_IMPEDANCE_OHMS - 1)).toBe(false)
  })

  it('accepts a real bare-foot impedance reading', () => {
    expect(hasValidImpedance(MIN_VALID_IMPEDANCE_OHMS)).toBe(true)
    expect(hasValidImpedance(504)).toBe(true)
  })
})
