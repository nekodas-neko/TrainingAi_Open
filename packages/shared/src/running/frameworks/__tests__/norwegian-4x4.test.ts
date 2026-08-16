import { describe, it, expect } from 'vitest'
import { norwegian4x4Framework } from '../norwegian-4x4'
import type { FrameworkContext } from '../../types'

function baseCtx(overrides: Partial<FrameworkContext> = {}): FrameworkContext {
  return {
    fitness: { maxHr: 185, restingHr: 55, vo2max: 42, thresholdHr: null, weeklyBaseMinutes: 120, source: 'baseline' },
    weekIndex: 0,
    runsThisWeek: [],
    goal: { kind: 'intervals', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null },
    ...overrides,
  }
}

describe('norwegian4x4Framework', () => {
  it('prescribes an easy run for a fresh plan with no history yet', () => {
    // Mirrors speedVo2maxFramework/polarizedFramework: canGoHard requires easySoFar >
    // hardSoFar, so a completely fresh week (0-0) always eases in with an easy run first
    // — never opens straight into the protocol's near-maximal-HR interval work.
    const p = norwegian4x4Framework.nextRun(baseCtx())
    expect(p.type).toBe('easy')
  })

  it('prescribes an interval session at the fixed 40-minute protocol duration once an easy day is done', () => {
    const p = norwegian4x4Framework.nextRun(baseCtx({ runsThisWeek: [{ type: 'easy', durationMin: 25 }] }))
    expect(p.type).toBe('interval')
    expect(p.durationMin).toBe(40)
    expect(p.targets.zoneIds).toEqual([4, 5])
  })

  it('does not prescribe back-to-back interval days — requires an easy day between', () => {
    const afterOneInterval = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }] }),
    )
    expect(afterOneInterval.type).not.toBe('interval')
  })

  it('caps interval sessions at 2 per week', () => {
    const afterEasyIntervalEasyInterval = norwegian4x4Framework.nextRun(
      baseCtx({
        runsThisWeek: [
          { type: 'interval', durationMin: 40 },
          { type: 'easy', durationMin: 25 },
          { type: 'interval', durationMin: 40 },
          { type: 'easy', durationMin: 25 },
        ],
      }),
    )
    expect(afterEasyIntervalEasyInterval.type).not.toBe('interval')
  })

  it('keeps the interval duration fixed across weeks (no volume growth on the protocol itself)', () => {
    const oneEasyDone = [{ type: 'easy' as const, durationMin: 25 }]
    const week0 = norwegian4x4Framework.nextRun(baseCtx({ weekIndex: 0, runsThisWeek: oneEasyDone }))
    const week8 = norwegian4x4Framework.nextRun(baseCtx({ weekIndex: 8, runsThisWeek: oneEasyDone }))
    expect(week0.type).toBe('interval')
    expect(week8.type).toBe('interval')
    expect(week0.durationMin).toBe(40)
    expect(week8.durationMin).toBe(40)
  })

  it('fills non-interval days with easy or long runs, never tempo', () => {
    const afterInterval = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }] }),
    )
    expect(['easy', 'long']).toContain(afterInterval.type)
  })

  it('prescribes the weekly long run before defaulting to easy', () => {
    const p = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }, { type: 'easy', durationMin: 25 }] }),
    )
    expect(p.type).toBe('long')
  })

  it('stamps its own frameworkKey', () => {
    const p = norwegian4x4Framework.nextRun(baseCtx())
    expect(p.frameworkKey).toBe('norwegian-4x4')
  })
})
