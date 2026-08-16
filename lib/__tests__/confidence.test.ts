import { describe, it, expect } from 'vitest'
import { confidenceFactors, LOW_CONFIDENCE_THRESHOLD, type ConfidenceInputs, computeConfidence, COLD_START_CONFIDENCE_BASE } from '@trainingai/shared/ai-periodization/confidence'

const full: ConfidenceInputs = {
  recentSessionCount: 3,
  has1rmHistory: true,
  hasMoodOrSoreness: true,
  hasAcwr: true,
  hasSleepOrHrvTrend: true,
}

describe('confidenceFactors', () => {
  it('returns no factors when the engine has full data', () => {
    expect(confidenceFactors(full)).toEqual([])
  })

  it('lists every missing data source', () => {
    const out = confidenceFactors({
      recentSessionCount: 0,
      has1rmHistory: false,
      hasMoodOrSoreness: false,
      hasAcwr: false,
      hasSleepOrHrvTrend: false,
    })
    expect(out.length).toBe(5)
    expect(out[0]).toMatch(/No recent sessions/)
    expect(out.some(r => /1RM history/.test(r))).toBe(true)
    expect(out.some(r => /mood/.test(r))).toBe(true)
    expect(out.some(r => /ACWR/.test(r))).toBe(true)
    expect(out.some(r => /sleep or HRV/.test(r))).toBe(true)
  })

  it('pluralises and counts recent sessions', () => {
    expect(confidenceFactors({ ...full, recentSessionCount: 1 })[0]).toBe('Only 1 recent session of this type logged')
    expect(confidenceFactors({ ...full, recentSessionCount: 2 })[0]).toBe('Only 2 recent sessions of this type logged')
  })

  it('does not flag session history once at the cap of 3', () => {
    expect(confidenceFactors({ ...full, recentSessionCount: 3 })).toEqual([])
  })

  it('exposes a sane low-confidence threshold', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThan(1)
  })
})

describe('computeConfidence', () => {
  it('cold start sits BELOW the low-confidence threshold', () => {
    const r = computeConfidence({ recentSessionCount: 0, has1rmHistory: false, hasMoodOrSoreness: false, hasAcwr: false, hasSleepOrHrvTrend: false })
    expect(r.confidence).toBeCloseTo(0.3, 5) // base 0.3 + 0 sessions — was 0.5, unreachable gate
    expect(r.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD)
    expect(r.tier).toBe(1)
  })

  it('adds 0.1 per recent session up to 3', () => {
    // 0.3 + 3×0.1 = 0.6
    expect(computeConfidence({ recentSessionCount: 5, has1rmHistory: false, hasMoodOrSoreness: false, hasAcwr: false, hasSleepOrHrvTrend: false }).confidence).toBeCloseTo(0.6, 5)
  })

  it('tier 2 (+0.1) needs 1RM history AND mood/soreness; tier 3 (+0.1) needs ACWR AND a sleep/HRV trend', () => {
    const t2 = computeConfidence({ recentSessionCount: 3, has1rmHistory: true, hasMoodOrSoreness: true, hasAcwr: false, hasSleepOrHrvTrend: false })
    expect(t2).toMatchObject({ tier: 2 })
    expect(t2.confidence).toBeCloseTo(0.7, 5) // 0.3 + 0.3 + 0.1
    const t3 = computeConfidence(full)
    expect(t3).toMatchObject({ tier: 3 })
    expect(t3.confidence).toBeCloseTo(0.8, 5) // 0.3 + 0.3 + 0.1 + 0.1
  })

  it('exposes the cold-start base constant', () => {
    expect(COLD_START_CONFIDENCE_BASE).toBe(0.3)
  })
})
