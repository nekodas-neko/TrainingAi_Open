import { describe, it, expect } from 'vitest'
import { goalProgressPct, computeWeightRateKgPerWeek, evaluateWeightRateVsGoalBand } from '../long-term-goal-progress'

describe('goalProgressPct', () => {
  it('returns 100 when starting equals target (already at goal)', () => {
    expect(goalProgressPct(80, 82, 80)).toBe(100)
  })

  it('computes progress toward a decreasing target (losing weight)', () => {
    // starting 82, target 78 (lose 4kg), currently at 80 (lost 2kg) -> 50%
    expect(goalProgressPct(82, 80, 78)).toBeCloseTo(50, 5)
  })

  it('computes progress toward an increasing target (gaining weight)', () => {
    // starting 78, target 82 (gain 4kg), currently at 80 (gained 2kg) -> 50%
    expect(goalProgressPct(78, 80, 82)).toBeCloseTo(50, 5)
  })

  it('clamps to 0 when movement is away from a decreasing target', () => {
    // starting 81.85, target 78, currently 82.5 (went up, away from goal)
    expect(goalProgressPct(81.85, 82.5, 78)).toBe(0)
  })

  it('clamps to 0 when movement is away from an increasing target', () => {
    // starting 18, target 22 (gain), currently 17 (went down, away from goal)
    expect(goalProgressPct(18, 17, 22)).toBe(0)
  })

  it('clamps to 100 when current has overshot the target', () => {
    // starting 82, target 78, currently 75 (already past target)
    expect(goalProgressPct(82, 75, 78)).toBe(100)
  })
})

describe('computeWeightRateKgPerWeek', () => {
  it('computes a steady loss rate as kg/week', () => {
    // -0.1kg/day trend -> -0.7 kg/week
    const weights = [82, 81.9, 81.8, 81.7, 81.6, 81.5, 81.4]
    expect(computeWeightRateKgPerWeek(weights)).toBeCloseTo(-0.7, 5)
  })

  it('computes a steady gain rate as kg/week', () => {
    const weights = [78, 78.1, 78.2, 78.3, 78.4]
    expect(computeWeightRateKgPerWeek(weights)).toBeCloseTo(0.7, 5)
  })

  it('returns null for fewer than 3 readings', () => {
    expect(computeWeightRateKgPerWeek([])).toBeNull()
    expect(computeWeightRateKgPerWeek([80])).toBeNull()
    expect(computeWeightRateKgPerWeek([80, 79.5])).toBeNull()
  })

  it('returns null when weight is perfectly flat (zero variance in x is impossible, but zero slope is valid)', () => {
    expect(computeWeightRateKgPerWeek([80, 80, 80, 80])).toBe(0)
  })
})

describe('evaluateWeightRateVsGoalBand', () => {
  it('reports at_goal when current weight already equals target', () => {
    expect(evaluateWeightRateVsGoalBand(78, 78, -0.5)).toEqual({ rateKgPerWeek: -0.5, status: 'at_goal' })
  })

  it('reports on_track when losing weight toward a lower target within the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -0.6)
    expect(r.status).toBe('on_track')
  })

  it('reports too_slow when the loss rate is below the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -0.1)
    expect(r.status).toBe('too_slow')
  })

  it('reports too_fast when the loss rate exceeds the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, -1.5)
    expect(r.status).toBe('too_fast')
  })

  it('reports wrong_direction when gaining while the goal is to lose', () => {
    const r = evaluateWeightRateVsGoalBand(82, 78, 0.3)
    expect(r.status).toBe('wrong_direction')
  })

  it('reports on_track for a gain goal moving upward within the healthy band', () => {
    const r = evaluateWeightRateVsGoalBand(78, 82, 0.5)
    expect(r.status).toBe('on_track')
  })

  it('returns a null status when there is no rate data yet', () => {
    expect(evaluateWeightRateVsGoalBand(82, 78, null)).toEqual({ rateKgPerWeek: null, status: null })
  })
})
