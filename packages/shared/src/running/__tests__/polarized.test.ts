import { describe, it, expect } from 'vitest'
import { getFramework } from '../framework'
import type { FitnessSnapshot, RunningGoal } from '../types'

const fitness: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: 168,
  weeklyBaseMinutes: 100, source: 'baseline',
}
const goal: RunningGoal = { kind: 'cardio_health', targetDistanceKm: null, targetDate: null }

describe('polarized 80/20 framework', () => {
  const fw = getFramework('polarized-80-20')

  it('is registered under its key', () => {
    expect(fw.key).toBe('polarized-80-20')
  })

  it('first run of the week with no history is an easy run', () => {
    const p = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [], goal })
    expect(p.type).toBe('easy')
    expect(p.durationMin).toBeGreaterThan(0)
    expect(p.frameworkKey).toBe('polarized-80-20')
    expect(p.rationale.length).toBeGreaterThan(0)
  })

  it('after ~4 easy runs, prescribes the weekly quality session', () => {
    const easy = { type: 'easy' as const, durationMin: 30 }
    const p = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [easy, easy, easy, easy], goal })
    expect(['interval', 'tempo']).toContain(p.type)
  })

  it('caps weekly volume growth at ~10% per week', () => {
    const p0 = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [], goal })
    const p2 = fw.nextRun({ fitness, weekIndex: 2, runsThisWeek: [], goal })
    // week-2 easy run is longer, but not more than ~1.1^2 of the week-0 one
    expect(p2.durationMin!).toBeLessThanOrEqual(Math.ceil(p0.durationMin! * 1.1 ** 2) + 1)
  })

  it('an unknown framework key throws (fail closed, not a silent default)', () => {
    expect(() => getFramework('nope')).toThrow()
  })
})
