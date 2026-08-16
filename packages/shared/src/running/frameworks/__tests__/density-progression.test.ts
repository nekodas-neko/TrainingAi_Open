import { describe, it, expect } from 'vitest'
import { densityProgressionFramework } from '../density-progression'
import type { FrameworkContext } from '../../types'

function baseCtx(overrides: Partial<FrameworkContext> = {}): FrameworkContext {
  return {
    fitness: { maxHr: 185, restingHr: 55, vo2max: 42, thresholdHr: null, weeklyBaseMinutes: 90, source: 'baseline' },
    weekIndex: 0,
    runsThisWeek: [],
    goal: { kind: 'endurance', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: 30 },
    ...overrides,
  }
}

describe('densityProgressionFramework', () => {
  it('holds duration fixed at timePerSessionMinutes across weeks', () => {
    const week0 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 0 }))
    const week5 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 5 }))
    expect(week0.durationMin).toBe(30)
    expect(week5.durationMin).toBe(30)
  })

  it('grows the distance target week over week', () => {
    const week0 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 0 }))
    const week4 = densityProgressionFramework.nextRun(baseCtx({ weekIndex: 4 }))
    expect(week4.distanceKm).toBeGreaterThan(week0.distanceKm!)
  })

  it('falls back to a flat default duration when the goal has no timePerSessionMinutes', () => {
    const ctx = baseCtx({ goal: { kind: 'endurance', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null } })
    const p = densityProgressionFramework.nextRun(ctx)
    expect(p.durationMin).toBe(30) // DEFAULT_SESSION_MIN
  })

  it('falls back to a flat default pace when no VO2max estimate exists', () => {
    const ctx = baseCtx({ fitness: { maxHr: 185, restingHr: 55, vo2max: null, thresholdHr: null, weeklyBaseMinutes: 90, source: 'age-estimate' } })
    const p = densityProgressionFramework.nextRun(ctx)
    // 30 min at the documented fallback pace (400 sec/km) = 4.5 km
    expect(p.distanceKm).toBeCloseTo(4.5, 1)
  })

  it('always prescribes an easy-effort, Zone 1-2 session', () => {
    const p = densityProgressionFramework.nextRun(baseCtx())
    expect(p.type).toBe('easy')
    expect(p.targets.zoneIds).toEqual([1, 2])
  })

  it('stamps its own frameworkKey', () => {
    const p = densityProgressionFramework.nextRun(baseCtx())
    expect(p.frameworkKey).toBe('density-progression')
  })
})
