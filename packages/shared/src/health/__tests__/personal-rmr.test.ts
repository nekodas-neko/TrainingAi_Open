// BF-33. A clinically measured RMR has to age somehow. The obvious rule is a validity window, and
// it fails at both ends — full trust the day before expiry, total discard the day after, while the
// thing that actually invalidates the measurement is a change in body composition, which has no
// fixed relationship to elapsed time.
//
// Cunningham is linear in fat-free mass, so a measurement carries exactly one thing the prediction
// does not: this person's residual from it. These pin that the residual is what survives.
import { describe, it, expect } from 'vitest'
import { personalRmr, cunninghamBmr } from '../body-composition'

describe('personalRmr', () => {
  it('returns null when there is no measurement, so callers fall back to the prediction', () => {
    expect(personalRmr(null, 60)).toBeNull()
    expect(personalRmr(undefined, 60)).toBeNull()
  })

  // The owner's real sheet: measured 1714 against a predicted 1513, +13%.
  it('reproduces the measurement exactly at the fat-free mass it was taken at', () => {
    const ffm = (1513 - 370) / 21.6            // the FFM Cunningham would predict 1513 from
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: ffm }, ffm)).toBeCloseTo(1714, 6)
  })

  // The whole point: it moves with the body rather than expiring.
  it('carries the residual forward to a new fat-free mass', () => {
    const atTest = 55, now = 58
    const out = personalRmr({ rmrKcal: 1714, ffmKgAtTest: atTest }, now)!
    expect(out - cunninghamBmr(now)).toBeCloseTo(1714 - cunninghamBmr(atTest), 6)
    // Gaining lean mass raises it, by exactly Cunningham's slope on the difference.
    expect(out - 1714).toBeCloseTo((now - atTest) * 21.6, 6)
  })

  it('moves down as well, when lean mass is lost', () => {
    const out = personalRmr({ rmrKcal: 1714, ffmKgAtTest: 58 }, 55)!
    expect(out).toBeLessThan(1714)
    expect(1714 - out).toBeCloseTo(3 * 21.6, 6)
  })

  // Without a body composition from the test there is no residual to compute. Returning the raw
  // measurement is honest; re-scaling it would invent precision nobody measured.
  it('returns the raw measurement when the test reported no fat-free mass', () => {
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: null }, 58)).toBe(1714)
  })

  it('returns the raw measurement when today\'s fat-free mass is unknown', () => {
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: 55 }, null)).toBe(1714)
  })

  // Never fabricate from junk — the same contract `bodyComposition` above it already keeps.
  it('refuses an implausible measurement rather than propagating it', () => {
    expect(personalRmr({ rmrKcal: 0, ffmKgAtTest: 55 }, 58)).toBeNull()
    expect(personalRmr({ rmrKcal: -100, ffmKgAtTest: 55 }, 58)).toBeNull()
    expect(personalRmr({ rmrKcal: NaN, ffmKgAtTest: 55 }, 58)).toBeNull()
  })

  it('falls back to the raw measurement on a junk fat-free mass rather than dividing by it', () => {
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: 0 }, 58)).toBe(1714)
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: 55 }, -1)).toBe(1714)
    expect(personalRmr({ rmrKcal: 1714, ffmKgAtTest: NaN }, 58)).toBe(1714)
  })
})
