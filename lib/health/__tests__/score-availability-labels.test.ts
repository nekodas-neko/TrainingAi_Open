import { describe, it, expect } from 'vitest'
import { scoreAvailability } from '@/lib/health/score-availability'
import { limitedInputsNote } from '@trainingai/shared/health/readiness-input-labels'

describe('limited-inputs note', () => {
  it('words whatever scoreAvailability reports missing, with no raw key', () => {
    const { missing } = scoreAvailability({})
    expect(missing.length).toBeGreaterThan(0)
    expect(limitedInputsNote(missing)).not.toMatch(/restingHeartRate/)
    expect(limitedInputsNote(missing)).toContain('resting heart rate')
  })
})
