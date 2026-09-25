// RV-165 — the height correction (160 → 158 cm) never reached the stored composition.
//
// Composition is computed ONCE, at ingest, from the profile of that moment. The owner corrected
// their height to match a DEXA printout, and every earlier reading is still a 160 cm number. That
// would be history and nothing more, except the DEXA calibration offset is fitted LIVE against those
// stored values — so one stale pair biases every corrected body-fat reading shown today.
//
// The fixture is not invented. These are real rows from `claude_ro.body_metrics`, read 2026-09-24,
// with the profile that produced them (158 cm today, born 1993-01-01, male → 33 at the time).
import { describe, it, expect } from 'vitest'
import { heightUsedForStoredBmr, recomputeStoredBodyFatPctAtHeight, computeBodyComposition } from '../composition'

const AGE = 33
const SEX = 'male'

/** Real production rows. `bf`/`bmr` are exactly what is stored. */
const ROWS = [
  { date: '2026-08-27', weightKg: 71.7,  bf: 25.3, bmr: 1557 },
  { date: '2026-08-30', weightKg: 71.25, bf: 25.1, bmr: 1553 },
  { date: '2026-09-01', weightKg: 71.7,  bf: 26.3, bmr: 1545 },
  { date: '2026-09-03', weightKg: 71.5,  bf: 26.2, bmr: 1543 },
]

describe('RV-165 — recovering the profile a stored reading was computed at', () => {
  it('recovers 160 cm before the correction and 158 cm after, from BMR alone', () => {
    // This is the whole basis of the fix: `bmrKcal` is Mifflin-St Jeor, which carries NO impedance
    // term and is linear in height, so the height used at ingest falls straight out of it.
    //
    // Tolerance is 0.1 cm and that number is not arbitrary: `bmr_kcal` is stored rounded to a whole
    // kcal, so ±0.5 kcal of information is already gone, and 0.5 / 6.25 = ±0.08 cm. The measured
    // recovery is 160.08 — the rounding, exactly. A tighter bound would be asserting a precision the
    // stored column does not carry.
    const h = (r: typeof ROWS[number]) => heightUsedForStoredBmr(r.bmr, r.weightKg, AGE, SEX)!
    expect(Math.abs(h(ROWS[0]) - 160)).toBeLessThan(0.1)   // 08-27, before
    expect(Math.abs(h(ROWS[1]) - 160)).toBeLessThan(0.1)   // 08-30, before
    expect(Math.abs(h(ROWS[2]) - 158)).toBeLessThan(0.1)   // 09-01, after
    expect(Math.abs(h(ROWS[3]) - 158)).toBeLessThan(0.1)   // 09-03, after
  })

  it('the 08-27 and 09-01 rows share a weight, so the BMR gap IS the height change', () => {
    // 71.7 kg on both days; 1557 vs 1545. 12 / 6.25 = 1.92 cm. The step in the owner's body-fat
    // trend is not physiology.
    expect(ROWS[0].weightKg).toBe(ROWS[2].weightKg)
    expect((ROWS[0].bmr - ROWS[2].bmr) / 6.25).toBeCloseTo(1.92, 2)
  })

  it('re-derives the 08-27 reading at the corrected height', () => {
    const at158 = recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: ROWS[0].bf, storedBmrKcal: ROWS[0].bmr,
      weightKg: ROWS[0].weightKg, ageYears: AGE, sex: SEX, heightCm: 158,
    })
    // Shorter at the same weight is a higher BMI, so body fat goes UP — which is why the stored
    // value understates it and the DEXA offset comes out too large.
    expect(at158).not.toBeNull()
    expect(at158!).toBeGreaterThan(ROWS[0].bf)
    expect(at158!).toBeCloseTo(26.2, 1)
  })

  it('the recovered impedance is physically plausible, which is what makes the inversion credible', () => {
    // Round-trip: re-derive at the ORIGINAL height and the stored value must come back. If the
    // recovered impedance were nonsense this would drift.
    const backAt160 = recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: ROWS[0].bf, storedBmrKcal: ROWS[0].bmr,
      weightKg: ROWS[0].weightKg, ageYears: AGE, sex: SEX, heightCm: 160,
    })
    expect(backAt160).toBeCloseTo(ROWS[0].bf, 1)
  })

  it('returns the stored value unchanged when the height already matches', () => {
    // "No correction needed" and "could not correct" are different answers — a caller that cannot
    // tell them apart would silently drop readings.
    const same = recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: ROWS[2].bf, storedBmrKcal: ROWS[2].bmr,
      weightKg: ROWS[2].weightKg, ageYears: AGE, sex: SEX, heightCm: 158,
    })
    expect(same).toBe(ROWS[2].bf)
  })

  it('refuses rather than invents when BMR is missing', () => {
    expect(recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: 25.3, storedBmrKcal: null,
      weightKg: 71.7, ageYears: AGE, sex: SEX, heightCm: 158,
    })).toBeNull()
  })

  // The three refusals below each have to be reached ON THEIR OWN. The guards overlap — an absurd
  // body-fat value usually implies a negative impedance index, which the earlier guard catches — so
  // a fixture chosen carelessly passes even with the guard it is meant to pin deleted. Each of these
  // was computed to land past the previous guards and stop at its own.

  it('refuses a value on the formula clamp EVEN when the impedance is perfectly plausible', () => {
    // Isolates the clamp guard. At bf = 3 / BMR 1424 / 39.4 kg / age 20 the recovered height is
    // 180 cm and the impedance comes out ~562 Ω — squarely in range, so nothing downstream objects.
    // A clamped value carries no information about what the formula produced, so it cannot be
    // inverted no matter how reasonable the rest looks.
    expect(recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: 3, storedBmrKcal: 1424,
      weightKg: 39.4, ageYears: 20, sex: SEX, heightCm: 178,
    })).toBeNull()
  })

  it('refuses when the recovered impedance is below a real adult range', () => {
    // Isolates the impedance-plausibility guard. bf = 21.0 against BMR 1557 gives a POSITIVE
    // impedance index (137.8), so it clears the negative-index check, and then resolves to ~186 Ω —
    // under the 200 Ω floor. Calibrating against a fabricated impedance is worse than dropping it.
    expect(recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: 21.0, storedBmrKcal: 1557,
      weightKg: 71.7, ageYears: AGE, sex: SEX, heightCm: 158,
    })).toBeNull()
  })

  it('refuses a body-fat value that implies a NEGATIVE impedance index', () => {
    // The earliest guard, kept distinct from the two above so a change to either is still caught.
    expect(recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: 55, storedBmrKcal: 1557,
      weightKg: 71.7, ageYears: AGE, sex: SEX, heightCm: 158,
    })).toBeNull()
  })

  it('round-trips a freshly computed reading — the inverse really is the inverse', () => {
    // Forward through the real formula, then back: no production fixture involved, so this pins the
    // algebra rather than the data.
    const forward = computeBodyComposition({ weightKg: 71.7, impedanceOhms: 494, heightCm: 160, ageYears: AGE, sex: SEX })
    const recovered = heightUsedForStoredBmr(forward.bmrKcal, 71.7, AGE, SEX)
    expect(recovered).toBeCloseTo(160, 1)
    const same = recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: forward.bodyFatPct, storedBmrKcal: forward.bmrKcal,
      weightKg: 71.7, ageYears: AGE, sex: SEX, heightCm: 160,
    })
    expect(same).toBeCloseTo(forward.bodyFatPct, 1)
  })
})
