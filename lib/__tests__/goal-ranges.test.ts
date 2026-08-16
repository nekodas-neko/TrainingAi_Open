import { describe, it, expect } from 'vitest'
import { goalRange, formatGoalRange, accessoryTargetRpe } from '@trainingai/shared/ai-periodization/goal-ranges'
import { expectedRpe, pctForExpectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'

// Mirrors the exact accessory-pct derivation the prescribe + workout-data routes perform
// (RPE-target load, clamped 40–85) so the route contract is unit-covered without mocking them.
function accessoryPctForReps(goal: string, reps: number): number {
  return Math.min(85, Math.max(40, pctForExpectedRpe(accessoryTargetRpe(goal), reps)))
}

describe('accessory RPE-target derivation (route contract)', () => {
  it('lands near the goal target RPE at settled reps across goals', () => {
    for (const goal of ['strength', 'powerbuilding', 'hypertrophy', 'endurance']) {
      for (const reps of [6, 8, 10, 12, 15]) {
        const pct = accessoryPctForReps(goal, reps)
        expect(pct).toBeGreaterThanOrEqual(40)
        expect(pct).toBeLessThanOrEqual(85)
        expect(Math.abs(expectedRpe(pct, reps) - accessoryTargetRpe(goal))).toBeLessThanOrEqual(0.4)
      }
    }
  })

  it('is heavier than the old fixed 60% low end at a typical 12-rep accessory', () => {
    // The owner's complaint: 60% × 12 read "RPE 6 · Light". The new derivation is meaningfully heavier.
    expect(accessoryPctForReps('powerbuilding', 12)).toBeGreaterThan(60)
  })
})

describe('goal-aware accessory bands', () => {
  it('strength accessories are heavier than hypertrophy accessories', () => {
    const s = goalRange('strength', 'accessory')
    const h = goalRange('hypertrophy', 'accessory')
    expect(s.pctMax).toBeGreaterThan(h.pctMin)
    expect(s.repMax).toBeLessThan(h.repMax) // strength = fewer reps, hypertrophy = more
  })

  it('derived accessory band edges land near the goal target RPE', () => {
    for (const goal of ['strength', 'powerbuilding', 'hypertrophy', 'strength+hypertrophy']) {
      const r = goalRange(goal, 'accessory')
      const target = accessoryTargetRpe(goal)
      expect(Math.abs(expectedRpe(r.pctMax, r.repMin) - target)).toBeLessThanOrEqual(0.4)
      expect(Math.abs(expectedRpe(r.pctMin, r.repMax) - target)).toBeLessThanOrEqual(0.4)
    }
  })

  it('every goal accessory targets a genuinely challenging effort (>= RPE 7.5)', () => {
    for (const goal of ['strength', 'powerbuilding', 'hypertrophy', 'endurance', 'power', 'strength+hypertrophy']) {
      expect(accessoryTargetRpe(goal)).toBeGreaterThanOrEqual(7.5)
    }
  })
})

describe('goalRange', () => {
  it('returns the goal-specific compound range for primaries', () => {
    expect(goalRange('powerbuilding', 'primary')).toEqual({ pctMin: 72.5, pctMax: 92.5, repMin: 2, repMax: 8 })
    // Strength keeps secondary == primary (heavy).
    expect(goalRange('strength', 'secondary')).toEqual(goalRange('strength', 'primary'))
  })

  it('gives powerbuilding secondaries a moderate band below the primary anchor', () => {
    const primary = goalRange('powerbuilding', 'primary')
    const secondary = goalRange('powerbuilding', 'secondary')
    expect(secondary).not.toEqual(primary)
    expect(secondary.pctMax).toBeLessThan(primary.pctMax)
    expect(secondary.repMin).toBeGreaterThan(primary.repMin)
  })

  it('gives accessories a goal-specific band (no longer goal-agnostic)', () => {
    // Accessories are now goal-aware: a strength program's accessories sit heavier/lower-rep than
    // a powerbuilding program's, rather than sharing one fixed band.
    expect(goalRange('powerbuilding', 'accessory')).not.toEqual(goalRange('strength', 'accessory'))
    expect(goalRange('hypertrophy', 'accessory').repMax).toBeGreaterThan(goalRange('hypertrophy', 'primary').repMax)
  })

  it('falls back to strength for an unknown goal', () => {
    expect(goalRange('nonsense', 'primary')).toEqual(goalRange('strength', 'primary'))
  })

  it('formats a readable range', () => {
    expect(formatGoalRange({ pctMin: 72.5, pctMax: 92.5, repMin: 2, repMax: 8 })).toBe('72.5–92.5% · 2–8 reps')
  })
})
