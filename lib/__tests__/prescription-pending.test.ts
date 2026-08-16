import { describe, it, expect } from 'vitest'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'

const state = (over: { prescription?: unknown; prescriptionStatus?: string } = {}) => ({
  prescription: null,
  prescriptionStatus: 'consumed',
  ...over,
}) as Parameters<typeof isAiPrescriptionPending>[0]

const aiActive = { isAiDynamic: true, isBaselinePhase: false }

describe('isAiPrescriptionPending', () => {
  it('is true when an ai_dynamic non-baseline slot is consumed with no prescription yet', () => {
    expect(isAiPrescriptionPending(state(), aiActive)).toBe(true)
  })

  it('is true when consumed with a RETAINED (stale) prescription — the normal post-completion state (E2-11)', () => {
    // completeWorkoutFromPayload flips status to consumed but leaves the old prescription JSONB;
    // the retry must still fire (the old signature required prescription==null and never matched).
    expect(isAiPrescriptionPending(state({ prescription: { exercises: [{ name: 'stale' }] }, prescriptionStatus: 'consumed' }), aiActive)).toBe(true)
  })

  it('is false once a fresh prescription has landed (status flips to pending/auto_applied)', () => {
    expect(isAiPrescriptionPending(state({ prescription: { exercises: [] }, prescriptionStatus: 'auto_applied' }), aiActive)).toBe(false)
    expect(isAiPrescriptionPending(state({ prescription: { exercises: [] }, prescriptionStatus: 'pending' }), aiActive)).toBe(false)
  })

  it('is false for a brand-new session (status none, nothing being generated)', () => {
    expect(isAiPrescriptionPending(state({ prescriptionStatus: 'none' }), aiActive)).toBe(false)
  })

  it('is false for a dismissed prescription (base style is intentional)', () => {
    expect(isAiPrescriptionPending(state({ prescriptionStatus: 'dismissed' }), aiActive)).toBe(false)
  })

  it('is false in the baseline phase (no per-set prescription is coming)', () => {
    expect(isAiPrescriptionPending(state(), { isAiDynamic: true, isBaselinePhase: true })).toBe(false)
  })

  it('is false for non-ai_dynamic programs', () => {
    expect(isAiPrescriptionPending(state(), { isAiDynamic: false, isBaselinePhase: false })).toBe(false)
  })

  it('is false when there is no periodization state', () => {
    expect(isAiPrescriptionPending(null, aiActive)).toBe(false)
  })
})
