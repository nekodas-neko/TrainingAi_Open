import { describe, it, expect } from 'vitest'
import { explainExerciseChoice } from '@trainingai/shared/ai-periodization/explain'

describe('explainExerciseChoice', () => {
  it('names the phase and its intent', () => {
    const out = explainExerciseChoice({ phase: 'accumulation', role: 'primary', rm1Trend: 'flat', rm1ChangeKg: 0 })
    expect(out[0]).toContain('Accumulation phase')
    expect(out[0]).toContain('higher volume')
  })

  it('distinguishes compound vs accessory set priority', () => {
    const primary = explainExerciseChoice({ phase: 'accumulation', role: 'primary', rm1Trend: 'flat', rm1ChangeKg: 0 })
    const accessory = explainExerciseChoice({ phase: 'accumulation', role: 'accessory', rm1Trend: 'flat', rm1ChangeKg: 0 })
    expect(primary.some(s => s.includes('Compound'))).toBe(true)
    expect(accessory.some(s => s.includes('Accessory'))).toBe(true)
  })

  it('explains load direction from the 1RM trend', () => {
    const up = explainExerciseChoice({ phase: 'intensification', role: 'primary', rm1Trend: 'up', rm1ChangeKg: 2.5 })
    expect(up.some(s => s.includes('trending up') && s.includes('2.5kg'))).toBe(true)
    const down = explainExerciseChoice({ phase: 'intensification', role: 'primary', rm1Trend: 'down', rm1ChangeKg: -3 })
    expect(down.some(s => s.includes('dipped'))).toBe(true)
  })

  it('mentions the last-set push when present', () => {
    expect(explainExerciseChoice({ phase: 'accumulation', role: 'primary', rm1Trend: 'flat', rm1ChangeKg: 0, lastSetMode: 'amrap' })
      .some(s => s.includes('AMRAP'))).toBe(true)
    expect(explainExerciseChoice({ phase: 'accumulation', role: 'accessory', rm1Trend: 'flat', rm1ChangeKg: 0, lastSetMode: 'plus1' })
      .some(s => s.includes('+1 rep'))).toBe(true)
  })
})

// Q-19: a bodyweight "1RM change in kg" is a change in a BW_REF-relative index, not in weight
// lifted, so these bullets — which are rendered to the user in the prescription card — must not
// quote the magnitude.
describe('explainExerciseChoice — bodyweight (Q-19)', () => {
  it('never puts a kg figure in a bodyweight rationale', () => {
    for (const rm1Trend of ['up', 'down', 'flat'] as const) {
      const out = explainExerciseChoice({
        phase: 'accumulation', role: 'primary', rm1Trend, rm1ChangeKg: 3.5, exerciseType: 'bodyweight',
      })
      expect(out.join(' ')).not.toMatch(/kg/i)
    }
  })

  it('still reports the direction, in reps language', () => {
    const up = explainExerciseChoice({
      phase: 'accumulation', role: 'primary', rm1Trend: 'up', rm1ChangeKg: 3.5, exerciseType: 'bodyweight',
    })
    expect(up.join(' ')).toContain('rep max is trending up')
    const down = explainExerciseChoice({
      phase: 'accumulation', role: 'primary', rm1Trend: 'down', rm1ChangeKg: -3.5, exerciseType: 'bodyweight',
    })
    expect(down.join(' ')).toContain('rep max dipped')
  })

  it('leaves weighted exercises quoting kg as before', () => {
    const out = explainExerciseChoice({
      phase: 'accumulation', role: 'primary', rm1Trend: 'up', rm1ChangeKg: 3.5, exerciseType: 'weighted',
    })
    expect(out.join(' ')).toContain('+3.5kg')
  })
})
