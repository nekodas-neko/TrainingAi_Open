import { describe, it, expect } from 'vitest'
import { scoreBand } from '@trainingai/shared/health/score-band'

describe('scoreBand', () => {
  it('maps scores to canonical bands', () => {
    expect(scoreBand(85)).toEqual({ label: 'High', color: '#22c55e' })
    expect(scoreBand(70)).toEqual({ label: 'High', color: '#22c55e' })
    expect(scoreBand(69)).toEqual({ label: 'Moderate', color: '#f59e0b' })
    expect(scoreBand(50)).toEqual({ label: 'Moderate', color: '#f59e0b' })
    expect(scoreBand(49)).toEqual({ label: 'Low', color: '#ef4444' })
    expect(scoreBand(0)).toEqual({ label: 'Low', color: '#ef4444' })
  })
})
