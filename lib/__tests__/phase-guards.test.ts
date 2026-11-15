import { describe, it, expect } from 'vitest'
import {
  applyDeloadFloor,
  DELOAD_FLOOR,
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

// The per-type ceilings were replaced by the program's caps in training weeks (#3766):
// lib/__tests__/program-phase-3766.test.ts.

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
