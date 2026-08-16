import { describe, it, expect } from 'vitest'
import { applyRecoveryGate, type RecoveryGateInputs } from '../recovery-gate'
import type { Prescription } from '../types'

const hardRun: Prescription = {
  type: 'interval', durationMin: 40, distanceKm: null,
  targets: { zoneIds: [4, 5], hrLowBpm: 162, hrHighBpm: 190 },
  rationale: 'ideal', frameworkKey: 'polarized-80-20',
}
const base: RecoveryGateInputs = {
  readiness: 80, readinessProvisional: false,
  hoursSinceLowerBodyStrength: 96, lastLowerBodyVolumeKg: 0,
  monotony: null, acwr: 1.0, hoursSinceLastHardRun: 48, sleepHoursLastNight: 8,
}

describe('applyRecoveryGate', () => {
  it('proceeds when everything is fresh', () => {
    const r = applyRecoveryGate(hardRun, base)
    expect(r.action).toBe('proceed')
    expect(r.prescription.type).toBe('interval')
  })

  it('softens a hard run the day after a heavy leg session (interference effect)', () => {
    const r = applyRecoveryGate(hardRun, { ...base, hoursSinceLowerBodyStrength: 18, lastLowerBodyVolumeKg: 6000 })
    expect(r.action).toBe('soften')
    expect(r.prescription.type).toBe('easy')
    expect(r.reasons.some((x) => /leg|lower-body|interference/i.test(x))).toBe(true)
  })

  it('rests when readiness is very low', () => {
    const r = applyRecoveryGate(hardRun, { ...base, readiness: 45 })
    expect(r.action).toBe('rest')
    expect(r.prescription.type).toBe('recovery')
  })

  it('softens (never rests) when readiness is still provisional — degrade, do not fabricate', () => {
    const r = applyRecoveryGate(hardRun, { ...base, readiness: null, readinessProvisional: true })
    expect(r.action).toBe('soften')
    expect(r.reasons.some((x) => /readiness.*(learning|provisional)/i.test(x))).toBe(true)
  })

  it('softens on very high ACWR spike', () => {
    const r = applyRecoveryGate(hardRun, { ...base, acwr: 1.6 })
    expect(r.action).toBe('soften')
  })

  it('softens a hard run when training monotony is high (Foster >2.0)', () => {
    const r = applyRecoveryGate(hardRun, { ...base, monotony: 2.4 })
    expect(r.action).toBe('soften')
    expect(r.reasons.some((x) => /monoton/i.test(x))).toBe(true)
  })

  it('does NOT apply the monotony guard to an already-easy run', () => {
    const easy: Prescription = { ...hardRun, type: 'easy', targets: { zoneIds: [1, 2], hrLowBpm: 100, hrHighBpm: 148 } }
    const r = applyRecoveryGate(easy, { ...base, monotony: 2.4 })
    expect(r.action).toBe('proceed')
  })

  it('softens a hard run within a day of the last completed hard run (no back-to-back quality)', () => {
    const r = applyRecoveryGate(hardRun, { ...base, hoursSinceLastHardRun: 6 })
    expect(r.action).toBe('soften')
    expect(r.reasons.some((x) => /hard run|back-to-back|80\/20/i.test(x))).toBe(true)
  })

  it('does not gate on hard-run spacing when the last quality run was over a day ago', () => {
    const r = applyRecoveryGate(hardRun, { ...base, hoursSinceLastHardRun: 30 })
    expect(r.action).toBe('proceed')
  })

  it('leaves an already-easy run untouched even when softening', () => {
    const easy: Prescription = { ...hardRun, type: 'easy', targets: { zoneIds: [1, 2], hrLowBpm: 100, hrHighBpm: 148 } }
    const r = applyRecoveryGate(easy, { ...base, acwr: 1.6 })
    expect(r.prescription.type).toBe('easy') // softening a soft run is a no-op on type
  })
})
