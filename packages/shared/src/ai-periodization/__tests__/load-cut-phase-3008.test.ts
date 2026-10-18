import { describe, it, expect } from 'vitest'
import { loadCutPhase } from '../autoregulation'

describe('loadCutPhase', () => {
  it('reads the session, with baseline winning over deload', () => {
    expect(loadCutPhase({})).toBe('normal')
    expect(loadCutPhase({ isDeload: true })).toBe('deload')
    expect(loadCutPhase({ isBaseline: true, isDeload: true })).toBe('baseline')
  })
})
