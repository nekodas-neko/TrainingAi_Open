import { describe, it, expect } from 'vitest'
import { estWorkoutKcalFromHr, HR_MIN_PLAUSIBLE, HR_MAX_PLAUSIBLE } from '../workout-energy'

/**
 * Q-421 — a heart-rate-based estimate, so the workout burn responds to effort rather than only to
 * the clock.
 *
 * Unlike the MET path, this is assertable in magnitude here: the Keytel regression is arithmetic in
 * the module, with no vendored constant behind it. That is a deliberate property of choosing the
 * closed form first — the ONNX model would put every number back behind a runtime-only file.
 */
const male = { ageYears: 33, weightKg: 80, sex: 'male' as const }

describe('estWorkoutKcalFromHr (Q-421)', () => {
  it('reproduces the published regression', () => {
    // male: −55.0969 + 0.6309·140 + 0.1988·80 + 0.2017·33 = 55.98… kJ/min → /4.184 → kcal/min
    const kjPerMin = -55.0969 + 0.6309 * 140 + 0.1988 * 80 + 0.2017 * 33
    const expected = (kjPerMin / 4.184) * 45
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ...male })!).toBeCloseTo(expected, 9)
  })

  // The whole point: harder sessions of equal length cost more. The MET path cannot express this.
  it('scales with heart rate at equal duration', () => {
    const easy = estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 110, ...male })!
    const hard = estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 165, ...male })!
    expect(hard).toBeGreaterThan(easy)
  })

  it('scales linearly with duration', () => {
    const short = estWorkoutKcalFromHr({ durationMin: 20, avgBpm: 140, ...male })!
    const long = estWorkoutKcalFromHr({ durationMin: 40, avgBpm: 140, ...male })!
    expect(long).toBeCloseTo(short * 2, 9)
  })

  // The regression was fitted on exercising subjects, so at the bottom of the range it can go
  // negative — but NOT for every profile, which is worth pinning because the first draft of this
  // test assumed it did. A 33-year-old at 80 kg is still +1.27 kcal/min at 60 bpm; a 20-year-old at
  // 50 kg is −0.78 and gets floored. A negative burn is not a number to hand any surface.
  it('floors at zero for a profile where the regression goes negative', () => {
    const light = { ageYears: 20, weightKg: 50, sex: 'male' as const }
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: HR_MIN_PLAUSIBLE, ...light })).toBe(0)
  })

  it('does not floor a profile that is still positive at the same bpm', () => {
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: HR_MIN_PLAUSIBLE, ...male })!).toBeGreaterThan(0)
  })

  // Out of the fitted range it defers to the MET path rather than extrapolating.
  it.each([HR_MIN_PLAUSIBLE - 1, HR_MAX_PLAUSIBLE + 1, 0, -5, 400])('returns null for an implausible bpm (%s)', bpm => {
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: bpm, ...male })).toBeNull()
  })

  // 36 of 78 sessions have no HR at all, so this is the common case, not an edge case.
  it.each([null, undefined, NaN])('returns null when there is no usable HR (%s)', bpm => {
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: bpm as number | null, ...male })).toBeNull()
  })

  it('returns null on an incomplete profile rather than inventing one', () => {
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ageYears: null, weightKg: 80, sex: 'male' })).toBeNull()
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ageYears: 33, weightKg: null, sex: 'male' })).toBeNull()
    expect(estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ageYears: 33, weightKg: 80, sex: null })).toBeNull()
  })

  it('uses the female coefficients, which are genuinely different', () => {
    const m = estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ageYears: 33, weightKg: 80, sex: 'male' })!
    const f = estWorkoutKcalFromHr({ durationMin: 45, avgBpm: 140, ageYears: 33, weightKg: 80, sex: 'female' })!
    expect(f).not.toBeCloseTo(m, 1)
    expect(f).toBeGreaterThan(0)
  })

  it('rejects a non-positive duration', () => {
    expect(estWorkoutKcalFromHr({ durationMin: 0, avgBpm: 140, ...male })).toBeNull()
    expect(estWorkoutKcalFromHr({ durationMin: -10, avgBpm: 140, ...male })).toBeNull()
  })
})
