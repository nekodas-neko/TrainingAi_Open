// lib/health/__tests__/rmssd.test.ts
import { describe, it, expect } from 'vitest'
import { rmssdFromRr } from '@trainingai/shared/health/rmssd'

describe('rmssdFromRr', () => {
  it('computes rMSSD over successive differences', () => {
    // 30 beats alternating 800/820 → every successive diff is ±20 → rMSSD = 20
    const rr = Array.from({ length: 30 }, (_, i) => (i % 2 ? 820 : 800))
    expect(rmssdFromRr(rr)).toBeCloseTo(20, 5)
  })

  it('returns null with fewer than 30 beats (too little signal)', () => {
    expect(rmssdFromRr(Array.from({ length: 29 }, () => 800))).toBeNull()
  })

  it('excludes artifact pairs (>20% jump) from the differences', () => {
    // A 300 ms ectopic jump inside otherwise steady 800s must not dominate.
    const steady = Array.from({ length: 40 }, () => 800)
    const withArtifact = [...steady.slice(0, 20), 1100, ...steady.slice(21)]
    const clean = rmssdFromRr(steady)!
    const filtered = rmssdFromRr(withArtifact)!
    expect(filtered).toBeLessThan(clean + 5)
  })

  it('is null when everything is filtered', () => {
    // Alternating wild values: every pair is an artifact.
    expect(rmssdFromRr(Array.from({ length: 40 }, (_, i) => (i % 2 ? 400 : 1600)))).toBeNull()
  })
})
