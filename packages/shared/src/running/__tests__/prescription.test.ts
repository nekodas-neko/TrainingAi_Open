import { describe, it, expect } from 'vitest'
import { prescribeNextRun } from '../prescription'
import type { FitnessSnapshot, RunningGoal } from '../types'
import type { RecoveryGateInputs } from '../recovery-gate'

const fitness: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: 168,
  weeklyBaseMinutes: 120, source: 'baseline',
}
const goal: RunningGoal = { kind: 'cardio_health', targetDistanceKm: null, targetDate: null }
const fresh: RecoveryGateInputs = {
  readiness: 82, readinessProvisional: false, hoursSinceLowerBodyStrength: 96,
  lastLowerBodyVolumeKg: 0, monotony: null, acwr: 1.0, hoursSinceLastHardRun: 48, sleepHoursLastNight: 8,
}
const fourEasy = [
  { type: 'easy' as const, durationMin: 30 }, { type: 'easy' as const, durationMin: 30 },
  { type: 'easy' as const, durationMin: 30 }, { type: 'easy' as const, durationMin: 30 },
]

describe('prescribeNextRun', () => {
  it('returns the framework run when recovery is fine', () => {
    const out = prescribeNextRun({ fitness, weekIndex: 0, runsThisWeek: fourEasy, goal }, fresh, 'polarized-80-20')
    expect(out.gateAction).toBe('proceed')
    expect(['interval', 'tempo']).toContain(out.prescription.type)
  })

  it('softens the quality session after a heavy leg day and re-bands HR to the easy zones', () => {
    const out = prescribeNextRun(
      { fitness, weekIndex: 0, runsThisWeek: fourEasy, goal },
      { ...fresh, hoursSinceLowerBodyStrength: 14, lastLowerBodyVolumeKg: 5000 },
      'polarized-80-20',
    )
    expect(out.gateAction).toBe('soften')
    expect(out.prescription.type).toBe('easy')
    expect(out.prescription.targets.zoneIds).toEqual([1, 2]) // re-targeted, not the interval band
  })
})
