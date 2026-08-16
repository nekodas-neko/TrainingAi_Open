import { describe, it, expect } from 'vitest'
import { PrescriptionSchema } from '@trainingai/shared/ai-periodization/prescription-schema'

function validPrescription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    phase: 'accumulation',
    phase_action: 'stay',
    exercises: [
      { session_exercise_id: 'ex-1', name: 'Barbell Bench Press', sets: 4, reps: 6, pct: 75, rest_sec: 120 },
    ],
    deload: false,
    reasoning: 'Test reasoning.',
    confidence: 0.8,
    ...overrides,
  }
}

describe('PrescriptionSchema', () => {
  it('rejects an empty exercises array — a schema-valid empty response must never auto-apply', () => {
    const result = PrescriptionSchema.safeParse(validPrescription({ exercises: [] }))
    expect(result.success).toBe(false)
  })

  it('accepts a well-formed, non-empty response', () => {
    const result = PrescriptionSchema.safeParse(validPrescription())
    expect(result.success).toBe(true)
  })
})
