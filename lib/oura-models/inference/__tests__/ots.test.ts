import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runTrainingStressScore, type OtsInput } from '../ots'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// The gates and the load flag are thresholds read out of the constants, not fixed numbers, so
// they move with the table. Only the validator-error case below is decided before any threshold
// is consulted, which is why it stays unguarded.
const itVendor = it.skipIf(!hasRealConstants())

const FIX = path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__')
const golden = JSON.parse(fs.readFileSync(path.join(FIX, 'training_stress_score_0_2_1.golden.json'), 'utf8'))

function inputFromGolden(over: Partial<OtsInput> = {}): OtsInput {
  return {
    startTimestampMs: golden.startTimestampMs,
    mets: Float32Array.from(golden.mets),
    age: golden.age,
    biologicalSex: golden.biologicalSex,
    rhr: golden.rhr,
    noOts: golden.noOts,
    tzChange: golden.tzChange,
    readiness: golden.readiness,
    vo2max: golden.vo2max,
    ...over,
  }
}

describe('OTS core parity vs TorchScript golden', () => {
  itVendor('matches the captured reference (final OTS) within 1e-3', () => {
    const out = runTrainingStressScore(inputFromGolden())
    expect(out, 'runTrainingStressScore returned null').not.toBeNull()
    expect(Math.abs(out!.ots - golden.refOts), `got ${out!.ots} vs ref ${golden.refOts}`).toBeLessThan(1e-3)
    expect(out!.high).toBe(golden.refHigh)
  })

  itVendor('gates (null) on tz_change, out-of-range readiness, and <360 valid MET minutes', () => {
    expect(runTrainingStressScore(inputFromGolden({ tzChange: 1 }))).toBeNull()
    expect(runTrainingStressScore(inputFromGolden({ readiness: 120 }))).toBeNull()
    // an all-<0.9 series cleans to all-NaN → every window has 0 valid minutes → null
    expect(runTrainingStressScore(inputFromGolden({ mets: new Float32Array(1440).fill(0.5) }))).toBeNull()
  })

  it('rejects a NaN-containing MET series (validator error 2)', () => {
    const bad = Float32Array.from(golden.mets)
    bad[10] = NaN
    expect(runTrainingStressScore(inputFromGolden({ mets: bad }))).toBeNull()
  })

  itVendor('accepts NaN vo2max (falls back to RHR weighting, still non-null)', () => {
    const out = runTrainingStressScore(inputFromGolden({ vo2max: NaN }))
    expect(out).not.toBeNull()
  })

  itVendor('flags high load when readiness<60 lowers the threshold and OTS clears it', () => {
    // hard training day: high METs push OTS well above the (readiness-lowered) 3.6 threshold
    const out = runTrainingStressScore(inputFromGolden({ mets: new Float32Array(1440).fill(8), readiness: 40 }))
    expect(out).not.toBeNull()
    expect(out!.high).toBe(true)
  })
})

/**
 * LA-40 — `runTrainingStressScore`'s docblock says *"Infallible: never throws"*, and one path did.
 *
 * `validate` bounds rhr, readiness and vo2max but **not age**. `getAgeGroup` then clamps only the
 * top for female/male (`age >= 80 ? 80`) while the `other` branch clamps both ends, so an age below
 * the lowest group left `indexOf` at -1, indexed `table[-1]`, and handed `undefined` to
 * `argminAbsDiff` — a TypeError out of a function the route calls with no try/catch, so
 * `GET /api/training-stress` 500s for that user rather than reporting a gate.
 *
 * Runs WITHOUT the vendored constants on purpose: an age of 5 has no row in any plausible
 * percentile table, so this discriminates against the synthetic fixtures too — which is the only
 * reason it can run in CI at all, where every parity block above skips.
 */
describe('an age outside the percentile table is gated, not thrown (LA-40)', () => {
  it('returns null rather than throwing', () => {
    const run = () => runTrainingStressScore(inputFromGolden({ age: 5, vo2max: NaN }))
    expect(run).not.toThrow()
    expect(run()).toBeNull()
  })

  it('and an ordinary age is covered by the same guard', () => {
    // Deliberately NOT "a normal age takes a different path": the synthetic age-group table is
    // placeholder values, so 33 is out of it too and this case throws without the fix exactly as
    // age 5 does. Against the vendor's own table 33 is in range and scores. What both cases pin,
    // on either set, is that no age reaches `argminAbsDiff` with an undefined row.
    expect(() => runTrainingStressScore(inputFromGolden({ age: 33, vo2max: NaN }))).not.toThrow()
  })
})
