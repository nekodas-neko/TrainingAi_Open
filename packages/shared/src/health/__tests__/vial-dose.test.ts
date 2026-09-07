import { describe, it, expect } from 'vitest'
import {
  concentrationMgPerMl, unitsForMg, mgForUnits, frozenReconstitution,
} from '../vial-dose'

// OR-102a. The number a user reads off a syringe is derived from two things they typed weeks ago,
// so the arithmetic has to be reversible and the failure cases have to be `null` rather than a
// plausible-looking number.
const U100 = { strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100 }

describe('concentration is derived, not stored', () => {
  it('is milligrams over millilitres', () => {
    expect(concentrationMgPerMl(U100)).toBe(5)
  })

  // `strengthMg / 0` is Infinity, which survives every later multiplication and renders as a
  // number. A vial with no water is a typo, not a very concentrated vial.
  it('refuses zero or negative water rather than returning Infinity', () => {
    expect(concentrationMgPerMl({ ...U100, waterMl: 0 })).toBeNull()
    expect(concentrationMgPerMl({ ...U100, waterMl: -2 })).toBeNull()
    expect(concentrationMgPerMl({ ...U100, strengthMg: 0 })).toBeNull()
  })

  it('refuses values that are not finite', () => {
    expect(concentrationMgPerMl({ ...U100, waterMl: NaN })).toBeNull()
    expect(concentrationMgPerMl({ ...U100, strengthMg: Infinity })).toBeNull()
  })
})

describe('milligrams to units and back', () => {
  it('converts a dose to units on a U-100 barrel', () => {
    // 10 mg in 2 ml is 5 mg/ml; 2.5 mg is half a millilitre; half a millilitre is 50 units.
    expect(unitsForMg(2.5, U100)).toBe(50)
  })

  it('honours a barrel that is not U-100', () => {
    // The same half-millilitre on a U-40 barrel is 20 marks, not 50. Assuming 100 here is a
    // wrong dose, which is why the number is stored rather than constant.
    expect(unitsForMg(2.5, { ...U100, syringeUnitsPerMl: 40 })).toBe(20)
  })

  // The two directions are the reason this lives in one module. A screen converts one way and
  // history converts the other; if they disagree the same dose reads as two different numbers.
  it('round-trips', () => {
    for (const mg of [0.5, 2.5, 7, 12.345]) {
      expect(mgForUnits(unitsForMg(mg, U100)!, U100)).toBeCloseTo(mg, 10)
    }
  })

  it('accepts a zero dose but refuses a negative one', () => {
    expect(unitsForMg(0, U100)).toBe(0)
    expect(unitsForMg(-1, U100)).toBeNull()
    expect(mgForUnits(-1, U100)).toBeNull()
  })

  it('refuses a barrel with no marks', () => {
    expect(unitsForMg(2.5, { ...U100, syringeUnitsPerMl: 0 })).toBeNull()
  })
})

describe('the frozen reconstitution on a log', () => {
  it('reads the three numbers back', () => {
    expect(frozenReconstitution({ vialStrengthMg: 10, vialWaterMl: 2, vialUnitsPerMl: 100 }))
      .toEqual(U100)
  })

  // The whole point of the freeze. A log with no stamp cannot be expressed in units, and saying so
  // is the honest answer — falling back to the CURRENT vial is the retroactive rewrite this
  // prevents: mix the next vial at a different volume and every past "15 units" changes meaning.
  it('is null when any of the three is missing, rather than falling back', () => {
    expect(frozenReconstitution({})).toBeNull()
    expect(frozenReconstitution({ vialStrengthMg: 10, vialWaterMl: 2 })).toBeNull()
    expect(frozenReconstitution({ vialStrengthMg: 10, vialWaterMl: null, vialUnitsPerMl: 100 })).toBeNull()
  })

  // A vial mixed at a different volume: the milligrams are unchanged and the units are not.
  it('shows why the stamp matters', () => {
    const asMixedThen = { strengthMg: 10, waterMl: 2, syringeUnitsPerMl: 100 }
    const asMixedNow  = { strengthMg: 10, waterMl: 1, syringeUnitsPerMl: 100 }
    expect(unitsForMg(2.5, asMixedThen)).toBe(50)
    expect(unitsForMg(2.5, asMixedNow)).toBe(25)
  })
})
