import { describe, it, expect } from 'vitest'
import {
  applyAccumulationCeiling,
  applyDeloadFloor,
  applyIntensificationCeiling,
  applyRealisationCeiling,
  ACCUMULATION_CEILING,
  DELOAD_FLOOR,
  INTENSIFICATION_CEILING,
  REALISATION_CEILING,
} from '@trainingai/shared/ai-periodization/phase-guards'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

function base(overrides: Partial<AiPrescription> = {}): AiPrescription {
  return {
    phase: 'accumulation',
    phaseAction: 'stay',
    exercises: [],
    estimatedSessionDurationMin: 45,
    weeklyVolumeContribution: {},
    deload: false,
    reasoning: 'Keep building volume.',
    confidence: 0.8,
    ...overrides,
  }
}

describe('applyAccumulationCeiling', () => {
  it('forces a transition to intensification at the ceiling when the AI says stay', () => {
    const out = applyAccumulationCeiling(base(), 'accumulation', ACCUMULATION_CEILING)
    expect(out.phaseAction).toBe('transition_recommended')
    expect(out.phase).toBe('intensification')
    expect(out.reasoning).toContain('accumulation sessions')
  })

  it('leaves the prescription untouched below the ceiling', () => {
    const p = base()
    expect(applyAccumulationCeiling(p, 'accumulation', ACCUMULATION_CEILING - 1)).toBe(p)
  })

  it('does not override a non-stay action even past the ceiling', () => {
    const p = base({ phaseAction: 'deload_recommended' })
    expect(applyAccumulationCeiling(p, 'accumulation', ACCUMULATION_CEILING + 3)).toBe(p)
  })

  it('only applies in the accumulation phase', () => {
    const p = base({ phase: 'intensification' })
    expect(applyAccumulationCeiling(p, 'intensification', 20)).toBe(p)
  })
})

describe('applyDeloadFloor', () => {
  it('forces a transition back to accumulation at the floor when the AI says stay', () => {
    const out = applyDeloadFloor(base({ phase: 'deload' }), 'deload', DELOAD_FLOOR)
    expect(out.phaseAction).toBe('transition_recommended')
    expect(out.phase).toBe('accumulation')
    expect(out.reasoning).toContain('deload sessions')
  })

  it('leaves the prescription untouched below the floor', () => {
    const p = base({ phase: 'deload' })
    expect(applyDeloadFloor(p, 'deload', DELOAD_FLOOR - 1)).toBe(p)
  })

  it('does not override a non-stay action even past the floor', () => {
    const p = base({ phase: 'deload', phaseAction: 'deload_recommended' })
    expect(applyDeloadFloor(p, 'deload', DELOAD_FLOOR + 2)).toBe(p)
  })

  it('only applies in the deload phase', () => {
    const p = base()
    expect(applyDeloadFloor(p, 'accumulation', 5)).toBe(p)
  })
})

describe('applyIntensificationCeiling', () => {
  it('forces transition_recommended → realisation at the cap when the AI says stay', () => {
    const out = applyIntensificationCeiling(base({ phase: 'intensification' }), 'intensification', INTENSIFICATION_CEILING)
    expect(out.phase).toBe('realisation')
    expect(out.phaseAction).toBe('transition_recommended')
  })
  it('leaves non-stay actions and under-cap counts untouched', () => {
    const stayPrescription = base({ phase: 'intensification' })
    const deloadPrescription = base({ phase: 'intensification', phaseAction: 'deload_recommended' })
    expect(applyIntensificationCeiling(stayPrescription, 'intensification', INTENSIFICATION_CEILING - 1)).toBe(stayPrescription)
    expect(applyIntensificationCeiling(deloadPrescription, 'intensification', INTENSIFICATION_CEILING)).toBe(deloadPrescription)
    expect(applyIntensificationCeiling(stayPrescription, 'accumulation', INTENSIFICATION_CEILING)).toBe(stayPrescription)
  })
})

describe('applyRealisationCeiling', () => {
  it('forces transition_recommended → deload after 2 realisation sessions (the rule the prompt already promises)', () => {
    const out = applyRealisationCeiling(base({ phase: 'realisation' }), 'realisation', REALISATION_CEILING)
    expect(out.phase).toBe('deload')
    expect(out.phaseAction).toBe('transition_recommended')
  })
})
