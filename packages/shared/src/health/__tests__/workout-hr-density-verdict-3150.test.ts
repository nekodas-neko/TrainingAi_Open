// #3150 — the density verdict stored with a workout's HR snapshot. Synthetic times only.
import { describe, it, expect } from 'vitest'
import { workoutHrDensityVerdict, HR_DENSE_MAX_GAP_MS } from '../intraday-hr-contributors'

const T0 = Date.UTC(2026, 2, 2, 2, 0)
const every = (stepMs: number, n: number, source: string | null) =>
  Array.from({ length: n }, (_, i) => ({ timestamp: T0 + i * stepMs, source }))

describe('workoutHrDensityVerdict (#3150)', () => {
  it('is null with nothing to judge', () => {
    expect(workoutHrDensityVerdict([])).toBeNull()
  })
  it('holds a gated-only series to the #2437 rule', () => {
    expect(workoutHrDensityVerdict(every(HR_DENSE_MAX_GAP_MS, 10, 'health_connect'))).toBe(true)
    expect(workoutHrDensityVerdict(every(HR_DENSE_MAX_GAP_MS + 1000, 10, 'apple_health'))).toBe(false)
    expect(workoutHrDensityVerdict(every(60_000, 1, 'health_connect_native'))).toBe(false)
  })
  it('passes any series with an ungated reading, as the calorie gate does', () => {
    expect(workoutHrDensityVerdict([...every(20 * 60_000, 3, 'health_connect'), { timestamp: T0 + 1, source: 'ble' }])).toBe(true)
    expect(workoutHrDensityVerdict(every(20 * 60_000, 3, null))).toBe(true)
  })
})
