import { describe, it, expect } from 'vitest'
import { computeRecoveryIndex } from '@trainingai/shared/health/recovery-index'

function series(bpms: number[], startHour: number): { timestamp: Date; bpm: number }[] {
  return bpms.map((bpm, i) => ({
    timestamp: new Date(Date.UTC(2026, 6, 9, startHour, 0, 0) + i * 5 * 60_000),
    bpm,
  }))
}

describe('computeRecoveryIndex', () => {
  it('returns null with fewer than 3 points', () => {
    expect(computeRecoveryIndex({ hrSeries: series([60, 58], 0), wakeTime: new Date() })).toBeNull()
  })

  it('finds the HR minimum and reports hours to wake', () => {
    // 22:00 -> 06:00, HR dips lowest around 02:00 (4h before a 06:00 wake).
    const hrSeries = series([70, 65, 60, 55, 52, 50, 48, 50, 55, 60], 22) // 5-min steps starting 22:00
    const wakeTime = new Date(Date.UTC(2026, 6, 9, 22, 0, 0) + 9 * 5 * 60_000)
    const r = computeRecoveryIndex({ hrSeries, wakeTime })
    expect(r).not.toBeNull()
    expect(r!.lowestBpm).toBeLessThanOrEqual(50)
    expect(r!.hoursToSettle).toBeGreaterThan(0)
    expect(r!.settledAt.getTime()).toBeLessThan(wakeTime.getTime())
  })

  it('never returns a negative hoursToSettle', () => {
    const hrSeries = series([60, 55, 50], 22)
    const wakeTime = hrSeries[0].timestamp // wake before the minimum was reached
    const r = computeRecoveryIndex({ hrSeries, wakeTime })
    expect(r!.hoursToSettle).toBe(0)
  })
})
