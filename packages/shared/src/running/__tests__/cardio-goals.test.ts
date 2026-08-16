import { describe, it, expect } from 'vitest'
import { CARDIO_GOALS, SELECTABLE_CARDIO_GOALS, defaultFrameworkForGoal } from '../cardio-goals'
import { weeklyZoneTargets } from '../zone-targets'
import { getFramework } from '../framework'
import type { FitnessSnapshot, FrameworkContext, RunType } from '../types'

const FITNESS: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: 168,
  weeklyBaseMinutes: 200, source: 'baseline',
}
const ctx = (runs: { type: RunType; durationMin: number | null }[], weekIndex = 0): FrameworkContext => ({
  fitness: FITNESS,
  weekIndex,
  runsThisWeek: runs,
  goal: { kind: 'speed', targetDistanceKm: 5, targetDate: null },
})

describe('cardio goal registry', () => {
  it('maps each goal to its framework', () => {
    expect(defaultFrameworkForGoal('speed')).toBe('speed-vo2max')
    expect(defaultFrameworkForGoal('endurance')).toBe('polarized-80-20')
    expect(defaultFrameworkForGoal('heart_health')).toBe('zone2-base')
    expect(defaultFrameworkForGoal('recovery')).toBe('aerobic-recovery')
    // legacy aliases still resolve
    expect(defaultFrameworkForGoal('cardio_health')).toBe('zone2-base')
    expect(defaultFrameworkForGoal('distance_event')).toBe('polarized-80-20')
  })

  it('offers exactly the five selectable goals (legacy hidden)', () => {
    expect(SELECTABLE_CARDIO_GOALS.map((g) => g.key).sort()).toEqual(
      ['endurance', 'heart_health', 'intervals', 'recovery', 'speed'],
    )
    expect(CARDIO_GOALS.cardio_health.selectable).toBe(false)
  })

  it('every framework a goal points to is registered', () => {
    for (const g of Object.values(CARDIO_GOALS)) {
      expect(() => getFramework(g.defaultFrameworkKey)).not.toThrow()
    }
  })
})

describe('weeklyZoneTargets', () => {
  it('splits speed volume ~70% easy / ~22% hard and meets the guideline', () => {
    const t = weeklyZoneTargets('speed-vo2max', 300)
    expect(t.totalMinutes).toBe(300)
    expect(t.easyShare).toBeCloseTo(0.70, 1)
    expect(t.hardShare).toBeCloseTo(0.22, 1)
    expect(t.meetsActivityGuideline).toBe(true)
    // per-zone minutes sum to the total (rounding tolerant)
    const sum = t.perZone.reduce((a, z) => a + z.minutes, 0)
    expect(Math.abs(sum - 300)).toBeLessThanOrEqual(2)
  })

  it('floors volume at the 150-min public-health guideline', () => {
    const t = weeklyZoneTargets('zone2-base', 90)
    expect(t.totalMinutes).toBe(150)
  })

  it('zone2-base is Zone-2 dominant with no Z5', () => {
    const t = weeklyZoneTargets('zone2-base', 200)
    const z = (id: number) => t.perZone.find((p) => p.zoneId === id)!.minutes
    expect(z(2)).toBeGreaterThan(z(1) + z(3) + z(4) + z(5)) // Z2 is the majority
    expect(z(5)).toBe(0)
  })

  it('aerobic-recovery is all easy — no Z4/Z5 minutes', () => {
    const t = weeklyZoneTargets('aerobic-recovery', 200)
    const z = (id: number) => t.perZone.find((p) => p.zoneId === id)!.minutes
    expect(z(4)).toBe(0)
    expect(z(5)).toBe(0)
    expect(t.easyShare).toBeGreaterThan(0.9)
  })

  it('falls back to the polarized split for an unknown framework', () => {
    const t = weeklyZoneTargets('nope', 300)
    expect(t.model).toBe('polarized')
  })

  it('norwegian-4x4 has its own zone weights, not the polarized-80-20 fallback', () => {
    const t = weeklyZoneTargets('norwegian-4x4', 300)
    const fallback = weeklyZoneTargets('polarized-80-20', 300)
    expect(t.perZone).not.toEqual(fallback.perZone)
    const sum = t.perZone.reduce((a, z) => a + z.minutes, 0)
    expect(Math.abs(sum - 300)).toBeLessThanOrEqual(2)
  })
})

describe('goal frameworks prescribe correctly', () => {
  it('speed framework: first quality is a VO₂max interval, then requires easy between hard', () => {
    // No runs yet → an easy run (needs an easy day before the first hard).
    expect(getFramework('speed-vo2max').nextRun(ctx([])).type).toBe('easy')
    // After 1 easy → the interval.
    expect(getFramework('speed-vo2max').nextRun(ctx([{ type: 'easy', durationMin: 30 }])).type).toBe('interval')
    // Straight after an interval (easySoFar == hardSoFar) → not another hard day.
    const afterInterval = getFramework('speed-vo2max').nextRun(
      ctx([{ type: 'easy', durationMin: 30 }, { type: 'interval', durationMin: 25 }]),
    )
    expect(['easy', 'long', 'recovery']).toContain(afterInterval.type)
  })

  it('zone2-base never prescribes intervals or tempo', () => {
    const fw = getFramework('zone2-base')
    for (let n = 0; n < 6; n++) {
      const runs = Array.from({ length: n }, () => ({ type: 'easy' as RunType, durationMin: 30 }))
      expect(['easy', 'long']).toContain(fw.nextRun(ctx(runs)).type)
    }
  })

  it('aerobic-recovery never prescribes hard work', () => {
    const fw = getFramework('aerobic-recovery')
    for (let n = 0; n < 6; n++) {
      const runs = Array.from({ length: n }, () => ({ type: 'easy' as RunType, durationMin: 30 }))
      expect(['easy', 'long', 'recovery']).toContain(fw.nextRun(ctx(runs)).type)
    }
  })
})
