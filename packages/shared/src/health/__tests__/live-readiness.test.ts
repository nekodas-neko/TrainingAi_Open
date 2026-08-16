import { describe, it, expect } from 'vitest'
import { liveReadinessForDay, liveReadinessByDay } from '@trainingai/shared/health/live-readiness'

// F8/E2-1/E2-12: readiness must come from the own BLE-derived composite, never the frozen Cloud
// column (dead since the 2026-07-07 re-key), except for genuinely pre-re-key days.
const derived = (day: string, score: number | null, source: string | null) =>
  ({ day, readinessScore: score, readinessSource: source }) as never
const cloud = (date: string, score: number | null) => ({ date, readinessScore: score }) as never

describe('liveReadinessForDay', () => {
  it('uses the ble-derived composite when present', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 42, 'ble-derived')], [])).toBe(42)
  })

  it('ignores a post-re-key Cloud score (frozen) even when derived is absent', () => {
    // A current day with only a frozen Cloud row → no live readiness.
    expect(liveReadinessForDay('2026-07-15', [], [cloud('2026-07-15', 88)])).toBeNull()
  })

  it('ignores a derived row that is NOT ble-derived (e.g. a Cloud-sourced derived row)', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 70, 'oura-cloud')], [])).toBeNull()
  })

  it('falls back to the Cloud score for a pre-re-key day (it was a real reading then)', () => {
    expect(liveReadinessForDay('2026-07-01', [], [cloud('2026-07-01', 61)])).toBe(61)
  })

  it('prefers the composite over Cloud on a pre-re-key day that has both', () => {
    expect(liveReadinessForDay('2026-07-01',
      [derived('2026-07-01', 55, 'ble-derived')], [cloud('2026-07-01', 61)])).toBe(55)
  })

  it('byDay maps each day to its live value', () => {
    const map = liveReadinessByDay(
      [derived('2026-07-14', 40, 'ble-derived'), derived('2026-07-15', null, 'ble-derived')],
      [cloud('2026-07-06', 72), cloud('2026-07-15', 90)],
    )
    expect(map.get('2026-07-14')).toBe(40)     // composite
    expect(map.get('2026-07-06')).toBe(72)     // pre-re-key Cloud fills the gap
    expect(map.has('2026-07-15')).toBe(false)  // null composite + post-re-key Cloud → absent
  })
})
