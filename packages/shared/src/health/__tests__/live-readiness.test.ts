import { describe, it, expect } from 'vitest'
import { liveReadinessForDay, liveReadinessByDay } from '@trainingai/shared/health/live-readiness'

// F8/E2-1/E2-12, #3000: readiness comes from our own composite only. Oura's readiness is never ours,
// for any day — the functions take no Oura rows at all.
const derived = (day: string, score: number | null, source: string | null) =>
  ({ day, readinessScore: score, readinessSource: source }) as never

describe('liveReadinessForDay', () => {
  it('uses the ble-derived composite when present', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 42, 'ble-derived')])).toBe(42)
  })

  it('is null when there is no composite for the day', () => {
    expect(liveReadinessForDay('2026-07-15', [])).toBeNull()
    expect(liveReadinessForDay('2026-07-01', [])).toBeNull() // pre-re-key days too (#3000)
  })

  it('ignores a derived row that is NOT ble-derived (e.g. a Cloud-sourced derived row)', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 70, 'oura-cloud')])).toBeNull()
  })

  it('byDay maps each day to its live value', () => {
    const map = liveReadinessByDay([derived('2026-07-14', 40, 'ble-derived'), derived('2026-07-15', null, 'ble-derived')])
    expect(map.get('2026-07-14')).toBe(40)
    expect(map.has('2026-07-15')).toBe(false)  // null composite → absent
  })
})
