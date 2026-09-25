import { describe, it, expect } from 'vitest'
import { computeTrainingStress, metGridFromDaytimeSamples, type TrainingStressInputs } from '../training-stress'
import type { Vo2MaxInputs } from '../vo2max'

/**
 * TN-79 — `insufficient_met` used to mean two unrelated things, and that is why Q-270 sat
 * unexplained for five weeks.
 *
 * `training_load_ots` is NULL on all 130 of the owner's days while `training_load_gate` reads a
 * reason on the 21 it recorded. Every one said `insufficient_met`, so every investigation went to
 * the MET stream — where nothing is wrong. Replaying the owner's own stored 0x50 frames through
 * `metGridFromDaytimeSamples` puts 8 of 9 recent days over both floors with room (2026-09-23: a
 * 1421-minute grid holding 1073 valid minutes, against 720 and 360).
 *
 * These pin that the two causes can no longer share a name.
 */

const base: Omit<TrainingStressInputs, 'startTimestampMs' | 'metsPerMinute'> = {
  age: 33, sex: 'male' as const, rhr: 59, readiness: 44, readinessProvisional: false, tzChange: 0,
  vo2maxInputs: {
    restingHr: 59, measuredMaxHr: null, age: 33, sex: 'male',
    weightKg: 71.7, heightCm: 158, activityLevel: null,
  } satisfies Vo2MaxInputs,
}

describe('the gate names which half failed (TN-79)', () => {
  it('a genuinely short MET series still says insufficient_met', () => {
    // 200 minutes of signal is below the 720-minute floor. This reason is CORRECT here, and keeping
    // it is the point — the fix is not to rename the honest case.
    const metsPerMinute: (number | null)[] = new Array(200).fill(1.2)
    const r = computeTrainingStress({ ...base, startTimestampMs: Date.parse('2026-09-23T00:00:00Z'), metsPerMinute })
    expect(r).toEqual({ status: 'gated', reason: 'insufficient_met' })
  })

  it('a series that CLEARS both floors never reports insufficient_met', () => {
    // The shape the owner's days actually have: well past both floors. Whatever happens next, the
    // answer must not blame the MET stream — that misattribution is the whole finding.
    const metsPerMinute: (number | null)[] = new Array(1421).fill(1.2)
    const r = computeTrainingStress({ ...base, startTimestampMs: Date.parse('2026-09-23T00:00:00Z'), metsPerMinute })
    // Deliberately NOT asserting it gates. Whether the scorer produces a number depends on the
    // vendor constants, which are absent from the public repo and from CI and present in
    // production — so pinning `status` here would pass for the wrong reason in one environment and
    // fail in the other. The invariant that holds everywhere is the one being claimed: a series
    // this long is never the MET stream's fault.
    if (r.status === 'gated') expect(r.reason).not.toBe('insufficient_met')
  })

  it('sparsity alone does not trip the MET floors — gaps are expected from this ring', () => {
    // The radio sleeps when worn-idle, so the grid is ALWAYS gappy. 1073 of 1421 minutes is a
    // normal day, not a degraded one, and the floors are written to tolerate exactly that.
    const samples: { tsMs: number; value: number }[] = []
    const t0 = Date.parse('2026-09-23T00:00:00Z')
    for (let m = 0; m < 1421; m++) if (m % 4 !== 3) samples.push({ tsMs: t0 + m * 60_000, value: 1.2 })
    const { metsPerMinute, startTimestampMs } = metGridFromDaytimeSamples(samples)
    expect(metsPerMinute.length).toBeGreaterThanOrEqual(720)
    expect(metsPerMinute.filter(v => v != null && v >= 0.9).length).toBeGreaterThanOrEqual(360)
    // And the floors must actually LET IT THROUGH. Counting the minutes is not the claim; the claim
    // is that a normally-gappy day is not blamed on the MET stream, so the gate has to be asked.
    const r = computeTrainingStress({ ...base, startTimestampMs, metsPerMinute })
    if (r.status === 'gated') expect(r.reason).not.toBe('insufficient_met')
  })
})
