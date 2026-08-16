import { describe, it, expect } from 'vitest'
import { shouldCountTowardPr } from '@trainingai/shared/workout/log-exercise'

describe('shouldCountTowardPr', () => {
  const base = { estimated1rm: 100, isAnyDeload: false, isBaseline: false, exerciseDeloaded: false }

  it('counts a normal full-intensity log', () => {
    expect(shouldCountTowardPr(base)).toBe(true)
  })

  it('never counts when there is no 1RM estimate', () => {
    expect(shouldCountTowardPr({ ...base, estimated1rm: 0 })).toBe(false)
  })

  it('does not count during a whole-session deload (existing behaviour)', () => {
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true })).toBe(false)
  })

  it('baseline sessions count even inside a deload window (existing behaviour)', () => {
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true, isBaseline: true })).toBe(true)
  })

  it('does not count a per-exercise-deloaded log', () => {
    expect(shouldCountTowardPr({ ...base, exerciseDeloaded: true })).toBe(false)
  })

  it('per-exercise deload blocks the PR even in a baseline session', () => {
    // A deloaded exercise is deliberately submaximal — its estimate is
    // meaningless for PRs regardless of the surrounding session type.
    expect(shouldCountTowardPr({ ...base, isBaseline: true, exerciseDeloaded: true })).toBe(false)
  })

  it('reverted exercise (flag false/absent) counts again', () => {
    expect(shouldCountTowardPr({ ...base, exerciseDeloaded: false })).toBe(true)
  })
})
