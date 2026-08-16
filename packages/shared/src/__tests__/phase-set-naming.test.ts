import { describe, it, expect } from 'vitest'
import { buildOwnedPhaseSetName } from '../phase-set-naming'

describe('buildOwnedPhaseSetName', () => {
  it('combines the template name and program name', () => {
    expect(buildOwnedPhaseSetName('Strength Progression', 'john')).toBe('Strength Progression (john)')
  })

  it('handles program names containing parentheses', () => {
    expect(buildOwnedPhaseSetName('Hypertrophy Progression', 'Push (A)')).toBe('Hypertrophy Progression (Push (A))')
  })
})
