import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  sixMwtVo2max, cooperVo2max, distanceCanBeScored, MIN_SCOREABLE_DISTANCE_M,
} from '../fitness-tests'

/**
 * BF-158. The owner asked for a pre-flight check before running the Cooper test for the first
 * time, and nearly ran it on a treadmill.
 *
 * **Both distance protocols take distance from GPS and nothing else** — `test-active.tsx` has no
 * treadmill toggle and no manual entry, unlike the guided walk. Indoors they produce a
 * full-length, correctly-timed capture with a distance near zero, and then score it.
 *
 * The entry named Cooper. The sibling was worse and is fixed here too: a clamp turns a bad number
 * into a plausible one, and on the 6MWT's profile-weighted branch the distance term barely
 * matters, so zero metres scores like a real result.
 */
describe('what the unguarded equations scored from no distance', () => {
  // Kept as the record of what the guard prevents. The equations are unchanged — the guard sits in
  // front of them — so these still compute exactly these values today.
  it('Cooper returns a NEGATIVE VO₂max, which at least announces itself', () => {
    expect(cooperVo2max(0)).toBe(-11.3)
    // The 504.9 intercept guarantees it: anything materially under 505 m is negative.
    expect(cooperVo2max(400)).toBe(-2.3)
    // Just under the intercept it rounds to NEGATIVE ZERO, which is not less than zero in JS —
    // so a guard written as `v < 0` would have let 504 m through as "0". Recorded because it is
    // the reason this guard is on the distance rather than on the equation's output.
    expect(cooperVo2max(504)).toBe(-0)
    expect(cooperVo2max(504) < 0).toBe(false)
    expect(cooperVo2max(505)).toBe(0)
  })

  it('the 6MWT Ross fallback clamps up to the floor and presents it as a reading', () => {
    // 4.948 + 0.023·0 = 4.9, clamped to VO2_FLOOR. Nothing marks it invalid.
    expect(sixMwtVo2max({ distanceM: 0, age: null, sex: null, weightKg: null, restingHr: null })).toBe(10)
  })

  it('the 6MWT Burr branch returns a wholly plausible number, which is the worst case', () => {
    // The owner's own profile. 70.161 − 0.276·70.2 − 0.193·50 − 0.191·33 = 34.83 → 34.8, with the
    // distance term contributing nothing. A reader cannot tell this from a real result, which is
    // why the guard is on the distance and not on the output.
    expect(sixMwtVo2max({ distanceM: 0, age: 33, sex: 'male', weightKg: 70.2, restingHr: 50 })).toBe(34.8)
  })
})

describe('the thresholds are derived from the equations, not chosen', () => {
  it('Cooper: the distance at which its own equation reaches the floor of 10', () => {
    expect(MIN_SCOREABLE_DISTANCE_M.cooper).toBe(952.2)
    // Derivation, re-run rather than restated: 10 × 44.73 + 504.9.
    expect(MIN_SCOREABLE_DISTANCE_M.cooper).toBeCloseTo(10 * 44.73 + 504.9, 1)
    expect(cooperVo2max(MIN_SCOREABLE_DISTANCE_M.cooper)).toBe(10)
  })

  it('6MWT: the same, from the Ross fallback — the branch that depends on distance alone', () => {
    expect(MIN_SCOREABLE_DISTANCE_M['6mwt']).toBe(219.7)
    expect(MIN_SCOREABLE_DISTANCE_M['6mwt']).toBeCloseTo((10 - 4.948) / 0.023, 1)
    // Burr is deliberately NOT used for the threshold: its profile terms can clear the floor with
    // no distance at all, so it cannot say anything about whether a distance is real.
    const rossAtThreshold = sixMwtVo2max({
      distanceM: MIN_SCOREABLE_DISTANCE_M['6mwt'], age: null, sex: null, weightKg: null, restingHr: null,
    })
    expect(rossAtThreshold).toBe(10)
  })

  it('both sit below the worst genuine effort, so a real test is never withheld', () => {
    // 952 m in 12 min is 4.8 km/h; 220 m in 6 min is 2.2 km/h. Slower than a walk, for protocols
    // that ask you to run and to walk briskly.
    expect((MIN_SCOREABLE_DISTANCE_M.cooper / 1000) / (12 / 60)).toBeCloseTo(4.8, 1)
    expect((MIN_SCOREABLE_DISTANCE_M['6mwt'] / 1000) / (6 / 60)).toBeCloseTo(2.2, 1)
  })
})

describe('distanceCanBeScored', () => {
  it('withholds at zero — the indoor case that prompted this', () => {
    expect(distanceCanBeScored('cooper', 0)).toBe(false)
    expect(distanceCanBeScored('6mwt', 0)).toBe(false)
  })

  it('withholds just below each threshold and scores at it', () => {
    expect(distanceCanBeScored('cooper', 952.1)).toBe(false)
    expect(distanceCanBeScored('cooper', 952.2)).toBe(true)
    expect(distanceCanBeScored('6mwt', 219.6)).toBe(false)
    expect(distanceCanBeScored('6mwt', 219.7)).toBe(true)
  })

  it('scores a real effort', () => {
    // The owner's 2026-09-14 Cooper run, and his 2026-07-19 6MWT (603 m, 18.8, ross_2010) — the
    // reference the entry names for the clamped sibling still behaving.
    expect(distanceCanBeScored('cooper', 1975)).toBe(true)
    expect(distanceCanBeScored('6mwt', 603)).toBe(true)
  })

  it('withholds on NaN rather than letting it through as a comparison that passes', () => {
    // `>=` is false for NaN, which is the behaviour wanted — asserted so a refactor to `<` plus a
    // negation cannot silently invert it.
    expect(distanceCanBeScored('cooper', Number.NaN)).toBe(false)
    expect(distanceCanBeScored('6mwt', Number.NaN)).toBe(false)
  })
})

describe('the result screen applies the guard and withholds the method with the score', () => {
  const root = path.resolve(__dirname, '../../../../..')
  const src = readFileSync(path.join(root, 'components/fitness-tests/test-result.tsx'), 'utf8')
  // Comments quote the broken values while explaining them, so a raw-source match would pass on prose.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

  it('gates the equations on the distance as well as the duration', () => {
    expect(code).toMatch(/distanceCanBeScored\(protocol\.vo2Equation,\s*capture\.distanceM\)/)
    expect(code).toMatch(/if\s*\(!endedEarly\s*&&\s*!distanceTooShort\)/)
  })

  it('leaves `method` null when no score was produced', () => {
    // Both assignments sit inside the guarded block: a row claiming `cooper_1968` with a null
    // vo2max would say a method ran that did not.
    const guarded = code.slice(code.indexOf('!distanceTooShort)'), code.indexOf('let restingHr'))
    expect(guarded).toMatch(/method = 'cooper_1968'/)
    expect(guarded).toMatch(/method = usedBurr/)
  })

  it('tells the user why, and does not reuse the early-stop wording', () => {
    expect(code).toMatch(/distanceTooShort/)
    expect(code).toMatch(/MIN_SCOREABLE_DISTANCE_M\[protocol\.vo2Equation\]/)
    // The two reasons are mutually exclusive in the UI: a truncated capture explains a short
    // distance, so naming the distance there would send the reader after a GPS fault.
    expect(code).toMatch(/!computed\.endedEarly\s*&&\s*computed\.distanceTooShort/)
  })
})
