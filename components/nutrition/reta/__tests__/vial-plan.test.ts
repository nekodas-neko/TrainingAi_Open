import { describe, expect, it } from 'vitest'
import { planDose, concentrationWorking, doseWorking, DEFAULT_BARREL_UNITS } from '../vial-plan'

// The owner's own vial, and the figures OR-102b verified against their third-party calculator.
const VIAL = { strengthMg: 10, waterMl: 3, syringeUnitsPerMl: 100 }

describe('planDose — OR-102b', () => {
  it('reproduces the owner-verified draw', () => {
    const p = planDose(0.5, VIAL)
    expect(p.concentration).toBeCloseTo(3.333, 3)
    expect(p.ml).toBeCloseTo(0.15, 2)
    expect(p.units).toBeCloseTo(15, 1)
  })

  it('counts whole doses from the milligrams, not from the volume', () => {
    // The substance is what runs out; the water is whoever mixed it's choice, so a vial mixed at
    // 3 mL and one mixed at 2 mL hold the same number of 0.5 mg doses.
    expect(planDose(0.5, VIAL).dosesInVial).toBe(20)
    expect(planDose(0.5, { ...VIAL, waterMl: 2 }).dosesInVial).toBe(20)
  })

  it('floors the count rather than reporting a partial dose as available', () => {
    expect(planDose(3, VIAL).dosesInVial).toBe(3)
  })

  it('refuses a vial that cannot describe a concentration instead of returning Infinity', () => {
    const p = planDose(0.5, { ...VIAL, waterMl: 0 })
    expect(p.concentration).toBeNull()
    expect(p.ml).toBeNull()
    expect(p.units).toBeNull()
    expect(p.dosesInVial).toBeNull()
  })

  it('returns no count for a zero dose, because dividing by it is not a number of doses', () => {
    expect(planDose(0, VIAL).dosesInVial).toBeNull()
  })

  it('flags a dose that will not fit in the barrel', () => {
    // 4 mg at 3.33 mg/mL is 1.2 mL — 120 marks on a 100-unit barrel.
    expect(planDose(4, VIAL).exceedsBarrel).toBe(true)
    expect(planDose(3, VIAL).exceedsBarrel).toBe(false)
    expect(planDose(4, VIAL, 200).exceedsBarrel).toBe(false)
  })

  it('does not flag a draw it could not compute', () => {
    expect(planDose(0.5, { ...VIAL, waterMl: 0 }).exceedsBarrel).toBe(false)
  })

  it('assumes a U-100 barrel by default, which is what the marks-per-mL default matches', () => {
    expect(DEFAULT_BARREL_UNITS).toBe(100)
  })
})

describe('the working is shown, not just the result — OR-102b', () => {
  it('spells out the concentration division', () => {
    expect(concentrationWorking(VIAL)).toBe('10 mg ÷ 3 mL = 3.33 mg/mL')
  })

  it('spells out the dose division, ending in the number drawn', () => {
    expect(doseWorking(0.5, VIAL)).toBe('0.5 mg ÷ 3.33 mg/mL = 0.15 mL → 15 units')
  })

  it('trims trailing zeros, so a round number does not read as measured to two places', () => {
    expect(concentrationWorking({ strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100 }))
      .toBe('10 mg ÷ 2 mL = 5 mg/mL')
  })

  it('says nothing rather than something wrong when the vial is unusable', () => {
    expect(concentrationWorking({ ...VIAL, strengthMg: 0 })).toBeNull()
    expect(doseWorking(0.5, { ...VIAL, waterMl: -1 })).toBeNull()
  })
})
