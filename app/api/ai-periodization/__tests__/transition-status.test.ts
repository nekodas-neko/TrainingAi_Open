import { describe, it, expect } from 'vitest'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'
import { POST_TRANSITION_STATUS } from '../session/[sessionId]/transition/status'

describe('the status a phase transition leaves behind', () => {
  // advancePhase clears the prescription. Whatever status is written must make
  // isAiPrescriptionPending true, or the pre-workout screen shows nothing at all: no card
  // (prescription is null), no "Preparing" placeholder, no poll, no regeneration trigger
  // (owner report, 2026-08-02).
  it('keeps the slot in the regenerating state', () => {
    expect(isAiPrescriptionPending(
      { prescription: null, prescriptionStatus: POST_TRANSITION_STATUS },
      { isAiDynamic: true, isBaselinePhase: false },
    )).toBe(true)
  })

  it("is not what advancePhase leaves behind on its own — 'none' is the bug", () => {
    expect(isAiPrescriptionPending(
      { prescription: null, prescriptionStatus: 'none' },
      { isAiDynamic: true, isBaselinePhase: false },
    )).toBe(false)
  })

  it('still shows base numbers during baseline, where no prescription is coming', () => {
    expect(isAiPrescriptionPending(
      { prescription: null, prescriptionStatus: POST_TRANSITION_STATUS },
      { isAiDynamic: true, isBaselinePhase: true },
    )).toBe(false)
  })
})
