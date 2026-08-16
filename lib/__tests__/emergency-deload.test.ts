import { describe, it, expect } from 'vitest'
import { shouldTriggerEmergencyDeload, type EmergencySignals, type EmergencyState } from '@trainingai/shared/ai-periodization/emergency-deload'

const calm: EmergencySignals = {
  consecutiveSessionDaysOfThisType: 1,
  hoursSinceLastSession: 72,
  soreMusclesInSession: [],
  activeInjuredMusclesInSession: [],
  acwr: 1.0,
  rpeTrend: null,
  repCompletionRate: null,
  selfReportedSick: false,
}
const idle: EmergencyState = { phase: 'accumulation', prescription: null, prescriptionStatus: 'none', prescriptionExpiresAt: null }
const now = new Date('2026-07-01T00:00:00Z')
const pendingEmergency = (expiresAt: Date): EmergencyState => ({
  phase: 'accumulation',
  prescription: { phase: 'deload', phaseAction: 'deload_recommended', exercises: [], estimatedSessionDurationMin: 30, weeklyVolumeContribution: {}, deload: true, reasoning: '', confidence: 1 },
  prescriptionStatus: 'pending',
  prescriptionExpiresAt: expiresAt,
})

describe('shouldTriggerEmergencyDeload', () => {
  it('fires on each overtraining condition independently', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, consecutiveSessionDaysOfThisType: 4 }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, hoursSinceLastSession: 20, soreMusclesInSession: ['a', 'b', 'c'] }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 1.6 }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, rpeTrend: { avgActual: 9.5, avgExpected: 7, delta: 2.5 } }, idle, now)).toBe(true)
    expect(shouldTriggerEmergencyDeload({ ...calm, repCompletionRate: 0.6 }, idle, now)).toBe(true)
  })

  it('does not fire on calm signals, and null signals never trigger', () => {
    expect(shouldTriggerEmergencyDeload(calm, idle, now)).toBe(false)
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: null, hoursSinceLastSession: null }, idle, now)).toBe(false)
  })

  it('AI-4: an active injury alone is no longer a standalone trigger (the prompt handles it via session_swap_recommended)', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, activeInjuredMusclesInSession: ['shoulders'] }, idle, now)).toBe(false)
    expect(shouldTriggerEmergencyDeload({ ...calm, activeInjuredMusclesInSession: ['shoulders', 'knees', 'back'] }, idle, now)).toBe(false)
  })

  it('never re-triggers while already in deload', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, { ...idle, phase: 'deload' }, now)).toBe(false)
  })

  it('never re-triggers while an unexpired emergency prescription is pending', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, pendingEmergency(new Date(now.getTime() + 86_400_000)), now)).toBe(false)
  })

  it('re-arms once the pending prescription expires or was dismissed', () => {
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, pendingEmergency(new Date(now.getTime() - 1)), now)).toBe(true)
    const dismissed = { ...pendingEmergency(new Date(now.getTime() + 86_400_000)), prescriptionStatus: 'dismissed' as const }
    expect(shouldTriggerEmergencyDeload({ ...calm, acwr: 2.0 }, dismissed, now)).toBe(true)
  })
})

describe('shouldTriggerEmergencyDeload — self-reported illness', () => {
  it('fires on illness alone, with every other signal calm', () => {
    // The lifter knows they have a fever before any biometric here does, so their own report
    // is a standalone trigger rather than a tiebreaker.
    expect(shouldTriggerEmergencyDeload({ ...calm, selfReportedSick: true }, idle, now)).toBe(true)
  })

  it('does not fire when illness is not reported', () => {
    expect(shouldTriggerEmergencyDeload(calm, idle, now)).toBe(false)
  })

  it('still respects the already-deloading suppression', () => {
    // Illness must not re-fire an emergency every prescribe call while one is already pending,
    // or it pins sessions_in_phase at 0 the same way the other triggers would.
    const sick = { ...calm, selfReportedSick: true }
    expect(shouldTriggerEmergencyDeload(sick, { ...idle, phase: 'deload' }, now)).toBe(false)
    expect(shouldTriggerEmergencyDeload(sick, pendingEmergency(new Date('2026-07-02T00:00:00Z')), now)).toBe(false)
  })
})
