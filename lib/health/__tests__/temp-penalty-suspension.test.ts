// TN-6a's pass test: while the suspension holds the temperature arm must contribute EXACTLY zero
// points, and readiness must rise by what the penalty was costing. Measured through the real
// `computeBlendedScore` rather than by reading the condition.
import { describe, it, expect } from 'vitest'
import { computeBlendedScore } from '@/lib/health/readiness-payload'

const SUSPENDED = false
const TRUSTED = true

describe('the suspended temperature ladder contributes nothing (TN-6a)', () => {
  // The three rungs, at deviations the owner's uncentred baseline produced on 91.2% of nights.
  it.each([
    ['the −10 rung', 0.4],
    ['the −20 rung', 0.7],
    ['the 40-point clamp', 1.2],
  ])('%s costs nothing while suspended', (_label, dev) => {
    const suspended = computeBlendedScore(80, null, dev, SUSPENDED)
    const clean = computeBlendedScore(80, null, null, SUSPENDED)
    expect(suspended.score).toBe(clean.score)
    expect(suspended.score).toBe(80)
  })

  it('is exactly the penalty that comes back when the baseline centres', () => {
    // Same inputs, only the trust flag differs — so the delta IS the ladder's contribution.
    expect(computeBlendedScore(80, null, 0.4, TRUSTED).score).toBe(70)
    expect(computeBlendedScore(80, null, 0.7, TRUSTED).score).toBe(60)
    expect(computeBlendedScore(80, null, 1.2, TRUSTED).score).toBe(40)
    for (const dev of [0.4, 0.7, 1.2]) {
      expect(computeBlendedScore(80, null, dev, SUSPENDED).score)
        .toBeGreaterThan(computeBlendedScore(80, null, dev, TRUSTED).score)
    }
  })

  it('suspends ONLY the temperature arm — ACWR still moves the score', () => {
    // The suppression must not quietly take the rest of the blend with it.
    const optimalAcwr = computeBlendedScore(80, 1.0, 0.7, SUSPENDED)
    expect(optimalAcwr.score).toBe(83)
    expect(optimalAcwr.source).toBe('oura+acwr')
    expect(computeBlendedScore(80, 2.0, 0.7, SUSPENDED).score).toBe(65)
  })

  it('leaves a below-threshold deviation alone in both states', () => {
    // Under 0.3 °C the ladder never fired, so suspending it changes nothing. Pins that the
    // suspension is not silently shifting scores it was never responsible for.
    expect(computeBlendedScore(80, null, 0.2, SUSPENDED).score)
      .toBe(computeBlendedScore(80, null, 0.2, TRUSTED).score)
  })
})
