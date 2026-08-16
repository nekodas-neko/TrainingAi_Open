import { describe, it, expect } from 'vitest'
import { GeneratedProgramSchema } from '@trainingai/shared/validation/generated-program'
import type { GeneratedProgram } from '@trainingai/shared/types/builder'

const valid: GeneratedProgram = {
  name: 'Upper/Lower',
  sessions: [{
    name: 'Upper A',
    icon: 'dumbbell',
    exercises: [{
      name: 'Bench Press',
      exerciseRole: 'primary',
      mainMuscles: ['Chest'],
      secondaryMuscles: ['Triceps'],
      progressionStyleName: 'Strength',
    }],
  }],
  phaseStructureName: 'Strength Progression',
  phaseSetId: 'abc-123',
  reasoning: 'Balanced split.',
  phases: [{ name: 'Accumulation', durationCycles: 4, phaseType: 'accumulation' }],
}

describe('GeneratedProgramSchema', () => {
  it('accepts a full generate-program payload and preserves it', () => {
    const parsed = GeneratedProgramSchema.parse(valid)
    expect(parsed).toEqual(valid)
  })

  it('fills defaults for optional top-level fields (older drafts)', () => {
    const { phases: _p, reasoning: _r, phaseSetId: _i, phaseStructureName: _s, ...minimal } = valid
    const parsed = GeneratedProgramSchema.parse(minimal)
    expect(parsed.phases).toEqual([])
    expect(parsed.reasoning).toBe('')
    expect(parsed.sessions[0].exercises[0].name).toBe('Bench Press')
  })

  it('rejects a program with no sessions, garbage, and oversized payloads', () => {
    expect(GeneratedProgramSchema.safeParse({ garbage: true }).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse(null).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse({ ...valid, sessions: [] }).success).toBe(false)
    const bloated = { ...valid, sessions: Array(8).fill(valid.sessions[0]) } // > 7 sessions
    expect(GeneratedProgramSchema.safeParse(bloated).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse({
      ...valid,
      sessions: [{ ...valid.sessions[0], exercises: [{ ...valid.sessions[0].exercises[0], exerciseRole: 'superset' }] }],
    }).success).toBe(false)
  })
})
