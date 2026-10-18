import { describe, it, expect } from 'vitest'
import { liveReadinessForDay, liveReadinessByDay, isOwnReadinessSource } from '@trainingai/shared/health/live-readiness'

// F8/E2-1/E2-12, #2992: readiness is the app's own composite, whatever device fed it, and never
// Oura's own readiness score.
const derived = (day: string, score: number | null, source: string | null) =>
  ({ day, readinessScore: score, readinessSource: source }) as never

describe('liveReadinessForDay', () => {
  it('uses the ring-era composite (ble-derived)', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 42, 'ble-derived')])).toBe(42)
  })

  it('#2992: an Oura-only day stored as generic-derived reaches the AI surfaces', () => {
    // From ~16 Nov no ring summary is in the window, so every Oura Cloud day is `generic-derived`.
    expect(liveReadinessForDay('2026-11-20', [derived('2026-11-20', 67, 'generic-derived')])).toBe(67)
  })

  it('ignores a derived row that is not our composite (e.g. a vendor score)', () => {
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 70, 'oura-cloud')])).toBeNull()
    expect(liveReadinessForDay('2026-07-15', [derived('2026-07-15', 70, null)])).toBeNull()
  })

  it('byDay maps each day to its live value and skips a null score', () => {
    const map = liveReadinessByDay([
      derived('2026-10-16', 40, 'ble-derived'),
      derived('2026-11-20', 58, 'generic-derived'),
      derived('2026-10-17', null, 'generic-derived'),
    ])
    expect(map.get('2026-10-16')).toBe(40)
    expect(map.get('2026-11-20')).toBe(58)
    expect(map.has('2026-10-17')).toBe(false)
  })
})

describe('isOwnReadinessSource', () => {
  it('accepts exactly the two labels the composite writes', () => {
    expect(isOwnReadinessSource('ble-derived')).toBe(true)
    expect(isOwnReadinessSource('generic-derived')).toBe(true)
    expect(isOwnReadinessSource('oura')).toBe(false)
    expect(isOwnReadinessSource(undefined)).toBe(false)
  })
})
