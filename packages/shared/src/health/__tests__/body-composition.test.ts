import { describe, it, expect } from 'vitest'
import {
  bodyComposition, cunninghamBmr, bodyCompSnapshot,
  isPlausibleBodyFatPct, PLAUSIBLE_BODY_FAT_PCT,
} from '../body-composition'

describe('bodyComposition', () => {
  it('derives fat mass, lean mass, and Cunningham BMR', () => {
    const c = bodyComposition(80, 20)!
    expect(c.fatMassKg).toBeCloseTo(16, 6) // 80 * 0.20
    expect(c.ffmKg).toBeCloseTo(64, 6) // 80 - 16
    expect(c.bmrKcal).toBeCloseTo(64 * 21.6 + 370, 6) // 1752.4
  })

  it('holds at the low end of the plausible band', () => {
    const c = bodyComposition(70, PLAUSIBLE_BODY_FAT_PCT.min)!
    expect(c.fatMassKg).toBeCloseTo(70 * 0.04, 6)
    expect(c.ffmKg).toBeCloseTo(70 - 70 * 0.04, 6)
    expect(c.bmrKcal).toBeCloseTo((70 - 70 * 0.04) * 21.6 + 370, 6)
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

  /**
   * Q-527. `body_comp` held one snapshot of 81 reading 3.0% body fat — 70.4 kg of lean mass on a
   * 72.6 kg bodyweight, and a stored BMR 24% above baseline. It is a no-contact scale reading
   * (impedance 0) that the estimator's own `clamp(…, 3, 60)` floored to 3, arriving here
   * indistinguishable from a measurement. `hasValidImpedance` refuses those at the scale now; this
   * is the last line before storage, for the sources it cannot see.
   *
   * Pinned to the real numbers rather than a round fixture, so the case this exists for is the
   * case that is tested.
   */
  it('rejects the floored no-contact scale reading (Q-527, 2026-07-29)', () => {
    expect(bodyComposition(72.55, 3)).toBeNull()
    expect(bodyCompSnapshot(72.55, 3)).toBeNull()
  })

  it('leaves every real reading in the series alone', () => {
    // The lowest and highest body fat actually recorded across all three sources in 81 snapshots.
    expect(bodyComposition(71.1, 22.2)).not.toBeNull()
    expect(bodyComposition(71.1, 25.5)).not.toBeNull()
  })
})

describe('isPlausibleBodyFatPct', () => {
  it('is inclusive at both ends of the band', () => {
    expect(isPlausibleBodyFatPct(PLAUSIBLE_BODY_FAT_PCT.min)).toBe(true)
    expect(isPlausibleBodyFatPct(PLAUSIBLE_BODY_FAT_PCT.max)).toBe(true)
  })

  it('rejects just outside it', () => {
    expect(isPlausibleBodyFatPct(PLAUSIBLE_BODY_FAT_PCT.min - 0.1)).toBe(false)
    expect(isPlausibleBodyFatPct(PLAUSIBLE_BODY_FAT_PCT.max + 0.1)).toBe(false)
  })

  /**
   * The floor has to sit ABOVE the scale estimator's own clamp floor or the floored value it
   * produces walks straight through. `lib/scale-ble/composition.ts` clamps to `[3, 60]`; a floor
   * equal to 3 would accept exactly the reading this guard exists for.
   */
  it('sits above the scale estimator clamp floor of 3', () => {
    expect(PLAUSIBLE_BODY_FAT_PCT.min).toBeGreaterThan(3)
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
