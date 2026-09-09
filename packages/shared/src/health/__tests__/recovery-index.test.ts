import { describe, it, expect } from 'vitest'
import { computeRecoveryIndex, nightRecoveryIndexHours } from '@trainingai/shared/health/recovery-index'

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

describe('nightRecoveryIndexHours — a fragmented night is one night (Q-509)', () => {
  const at = (iso: string) => new Date(iso)
  const seg = (end: string, settled?: string, bpm?: number) => ({
    sleepEnd: at(end),
    recovery: settled != null && bpm != null ? { settledAt: at(settled), lowestBpm: bpm } : null,
  })

  it('measures from the whole night’s minimum, not the final segment’s', () => {
    // 22:00–02:00 bottoming out at 01:00 (48 bpm), then 03:00–07:00 bottoming out at 05:00 (55).
    // The night's minimum is 01:00, so the answer is 07:00 − 01:00 = 6 h. Taking the final
    // segment's own value would report 2 h and describe a different sleep episode.
    const hours = nightRecoveryIndexHours([
      seg('2026-09-09T02:00:00Z', '2026-09-09T01:00:00Z', 48),
      seg('2026-09-09T07:00:00Z', '2026-09-09T05:00:00Z', 55),
    ])
    expect(hours).toBe(6)
  })

  it('still uses the LAST segment’s end as the wake time', () => {
    // Same minimum in the first segment, a later wake: the answer moves with the wake, which is
    // what distinguishes this from "just report the first segment's own hours" (that would be 1).
    const hours = nightRecoveryIndexHours([
      seg('2026-09-09T02:00:00Z', '2026-09-09T01:00:00Z', 48),
      seg('2026-09-09T09:30:00Z', '2026-09-09T05:00:00Z', 55),
    ])
    expect(hours).toBe(8.5)
  })

  it('takes the final segment when the night’s minimum is genuinely there', () => {
    const hours = nightRecoveryIndexHours([
      seg('2026-09-09T02:00:00Z', '2026-09-09T01:00:00Z', 60),
      seg('2026-09-09T07:00:00Z', '2026-09-09T05:00:00Z', 51),
    ])
    expect(hours).toBe(2)
  })

  it('keeps the EARLIER minimum on a tie, matching computeRecoveryIndex’s strict scan', () => {
    const hours = nightRecoveryIndexHours([
      seg('2026-09-09T02:00:00Z', '2026-09-09T01:00:00Z', 52),
      seg('2026-09-09T07:00:00Z', '2026-09-09T05:00:00Z', 52),
    ])
    expect(hours).toBe(6)
  })

  it('ignores a segment that produced no minimum, and returns null when none did', () => {
    expect(nightRecoveryIndexHours([
      seg('2026-09-09T02:00:00Z'),
      seg('2026-09-09T07:00:00Z', '2026-09-09T05:00:00Z', 55),
    ])).toBe(2)
    expect(nightRecoveryIndexHours([seg('2026-09-09T02:00:00Z'), seg('2026-09-09T07:00:00Z')])).toBeNull()
    expect(nightRecoveryIndexHours([])).toBeNull()
  })

  it('is unchanged for a single window — the overwhelmingly common case', () => {
    expect(nightRecoveryIndexHours([seg('2026-09-09T07:00:00Z', '2026-09-09T04:15:00Z', 50)])).toBe(2.75)
  })

  it('clamps to zero rather than reporting negative hours', () => {
    // A minimum stamped after the last window's end cannot happen from the estimator, but the
    // clamp is the same guarantee computeRecoveryIndex makes and callers rely on.
    expect(nightRecoveryIndexHours([seg('2026-09-09T02:00:00Z', '2026-09-09T03:00:00Z', 50)])).toBe(0)
  })
})
