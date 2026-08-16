import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { computeTrainingStress, metGridFromDaytimeSamples, type TrainingStressInputs } from '@trainingai/shared/health/training-stress'
// Relative, not `@/` — files under packages/shared are compiled by the package's own tsconfig,
// which carries no path mapping into the app root.
import { hasRealConstants } from '../../../../../lib/oura-models/__fixtures__/real-constants'

const golden = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'lib', 'oura-models', 'onnx', '__fixtures__', 'training_stress_score_0_2_1.golden.json'), 'utf8'))

function inputs(over: Partial<TrainingStressInputs> = {}): TrainingStressInputs {
  return {
    startTimestampMs: golden.startTimestampMs,
    metsPerMinute: golden.mets as number[],
    age: golden.age,
    sex: 'male',
    rhr: golden.rhr,
    readiness: golden.readiness,
    readinessProvisional: false,
    // measuredMaxHr 170 / rhr 55 → Uth 15.3×170/55 = 47.3, which buckets to the SAME
    // VO₂max category (2) as the golden's raw vo2max=45, so the derived-input path matches it.
    vo2maxInputs: { restingHr: golden.rhr, measuredMaxHr: 170, age: golden.age, sex: 'male', weightKg: 80, heightCm: 180, activityLevel: 'moderate' },
    tzChange: 0,
    ...over,
  }
}

describe('computeTrainingStress', () => {
  it('gates on null readiness', () => {
    expect(computeTrainingStress(inputs({ readiness: null }))).toEqual({ status: 'gated', reason: 'no_readiness' })
  })
  it('gates while the readiness baseline is still learning', () => {
    expect(computeTrainingStress(inputs({ readinessProvisional: true }))).toEqual({ status: 'gated', reason: 'readiness_learning' })
  })
  it('gates on an incomplete profile (missing rhr)', () => {
    expect(computeTrainingStress(inputs({ rhr: null }))).toEqual({ status: 'gated', reason: 'no_profile' })
  })
  it('gates when the MET series is too short', () => {
    expect(computeTrainingStress(inputs({ metsPerMinute: new Array(600).fill(1.2) }))).toEqual({ status: 'gated', reason: 'insufficient_met' })
  })
  it('gates when too few MET minutes are valid', () => {
    const mostlyLow = new Array(1440).fill(0.5); for (let i = 0; i < 300; i++) mostlyLow[i] = 1.2
    expect(computeTrainingStress(inputs({ metsPerMinute: mostlyLow }))).toEqual({ status: 'gated', reason: 'insufficient_met' })
  })
  // The forwarded value is the OTS model's, and the five gate cases above it reject before any
  // constant is read, so only this one needs the vendor's table.
  it.skipIf(!hasRealConstants())('forwards the OTS core value on a valid day (matches the golden)', () => {
    const r = computeTrainingStress(inputs())
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(Math.abs(r.ots - golden.refOts)).toBeLessThan(1e-3)
      expect(r.high).toBe(golden.refHigh)
      expect(r.vo2maxMethod).toBe('uth-sorensen')
    }
  })
})

describe('metGridFromDaytimeSamples (J-6)', () => {
  const MIN = 60_000
  // One 0x50 event carrying `n` consecutive 1-min bins, all stamped with the event ts (which the
  // batching convention anchors to the LAST bin).
  const event = (lastBinMs: number, values: number[]) =>
    values.map((value, j) => ({ tsMs: lastBinMs - (values.length - 1 - j) * MIN, value }))
      .map(b => ({ tsMs: lastBinMs, value: b.value })) // re-stamp every bin with the event ts

  it('reproduces contiguous flattening exactly (no spurious gaps)', () => {
    // Two back-to-back events: bins 0..2 ending at t2, bins 3..5 ending at t5.
    const t0 = 1_700_000_000_000
    const samples = [...event(t0 + 2 * MIN, [1, 2, 3]), ...event(t0 + 5 * MIN, [4, 5, 6])]
    const { metsPerMinute } = metGridFromDaytimeSamples(samples)
    expect(metsPerMinute).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('inserts nulls across a real inter-event gap (charger/non-wear)', () => {
    const t0 = 1_700_000_000_000
    // First event ends at minute 2; next event ends at minute 6 (a 3-minute hole).
    const samples = [...event(t0 + 2 * MIN, [1, 2, 3]), ...event(t0 + 6 * MIN, [4, 5])]
    const { metsPerMinute } = metGridFromDaytimeSamples(samples)
    // minutes 0,1,2 = 1,2,3 ; 3 = gap ; 4,5,6 = null? -> event ends at 6 with 2 bins => minutes 5,6
    expect(metsPerMinute[0]).toBe(1)
    expect(metsPerMinute[2]).toBe(3)
    expect(metsPerMinute[3]).toBeNull()
    expect(metsPerMinute[4]).toBeNull()
    expect(metsPerMinute[5]).toBe(4)
    expect(metsPerMinute[6]).toBe(5)
  })

  it('returns an empty series for no samples', () => {
    expect(metGridFromDaytimeSamples([])).toEqual({ startTimestampMs: 0, metsPerMinute: [] })
  })
})
