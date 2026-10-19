import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { activityStepsForDayCount, INDOOR_STEP_ACTIVITY_TYPES, PEDOMETER_ACTIVITY_TYPES } from '../activity-steps'

describe('activityStepsForDayCount (#3090)', () => {
  it('folds a treadmill session in and leaves outdoor foot activity out', () => {
    expect(activityStepsForDayCount([
      { activityType: 'treadmill', steps: 3_500 },
      { activityType: 'walk', steps: 4_100 },
      { activityType: 'run', steps: 5_600 },
      { activityType: 'hike', steps: 9_000 },
    ])).toBe(3_500)
  })

  it('ignores a type nobody has listed as indoor, and missing or zero steps', () => {
    expect(activityStepsForDayCount([
      { activityType: 'elliptical', steps: 2_000 },
      { activityType: 'treadmill', steps: null },
      { activityType: 'treadmill' },
      { activityType: 'treadmill', steps: 0 },
    ])).toBe(0)
  })

  it('matches the type case-insensitively, as the energy model does', () => {
    expect(activityStepsForDayCount([{ activityType: 'Treadmill', steps: 1_000 }])).toBe(1_000)
  })

  it('lists treadmill as the one indoor type', () => {
    expect(INDOOR_STEP_ACTIVITY_TYPES).toEqual(['treadmill'])
  })

  // A type on both lists would be added to the day's steps here AND taken back out of the energy
  // model's step term as already counted: the drift #3088 and #3090 each fixed one half of.
  it('never lists a type as both indoor and pedometer', () => {
    expect(INDOOR_STEP_ACTIVITY_TYPES.filter(t => PEDOMETER_ACTIVITY_TYPES.includes(t))).toEqual([])
    expect(PEDOMETER_ACTIVITY_TYPES).toEqual(['walk', 'run', 'hike'])
  })

  // A client component imports this module; a node builtin reached through an import would take the
  // screen down at build time, the failure `energy-baseline.ts` records twice.
  it('imports nothing', () => {
    const src = readFileSync(path.join(__dirname, '../activity-steps.ts'), 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/\brequire\(/)
  })
})
