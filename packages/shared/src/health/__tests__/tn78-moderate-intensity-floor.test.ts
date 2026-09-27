import { describe, it, expect } from 'vitest'
import { computeHrZones } from '../hr-zones'
import { accumulateZoneSeconds, activeMinutesFromZoneSeconds } from '../zone-minutes'

/**
 * TN-78 — the zone-minutes goal is WHO's MODERATE target, and it used to be scored at a
 * threshold where ACSM puts VIGOROUS. Owner's decision, 2026-09-27: moderate starts at 40% of
 * heart-rate reserve, so the Light band's floor moves 0.6 → 0.4.
 *
 * The point of the change is the band BETWEEN the two floors: brisk walking, which could not
 * earn a single active minute before. These pin that, because the pre-existing zone tests use
 * readings that sit clear of the boundary and so pass either way.
 */

// maxHr 190, restingHr 50 → reserve 140. Old Light floor 50+0.6*140 = 134; new 50+0.4*140 = 106.
const zones = computeHrZones({ maxHr: 190, restingHr: 50 })
const t = (min: number) => new Date(Date.UTC(2026, 8, 27, 1, 0, 0) + min * 60_000).getTime()

describe('the moderate-intensity floor (TN-78)', () => {
  it('puts the Light band at 40% of reserve, not 60%', () => {
    expect(zones[1].minBpm).toBe(106)
    // The band above it is untouched — only the floor moved, not the whole map.
    expect(zones[2].minBpm).toBe(148)
  })

  it('counts a brisk walk that the old floor ignored entirely', () => {
    // 120 bpm sits between the old floor (134) and the new one (106): the exact effort the goal
    // is about and the old threshold scored as nothing.
    const readings = [{ timestamp: t(0), bpm: 120 }, { timestamp: t(1), bpm: 120 }]
    const secs = accumulateZoneSeconds(readings, zones)
    expect(secs[1]).toBeCloseTo(60, 5)
    expect(secs[0]).toBe(0)
  })

  it('credits that minute ONCE — it is moderate, not vigorous', () => {
    // The doubling belongs to zones 3+. Widening Light must not quietly double a walk.
    const walk = accumulateZoneSeconds(
      [{ timestamp: t(0), bpm: 120 }, { timestamp: t(10), bpm: 120 }], zones, 600)
    expect(activeMinutesFromZoneSeconds(walk)).toBe(10)

    const run = accumulateZoneSeconds(
      [{ timestamp: t(0), bpm: 150 }, { timestamp: t(10), bpm: 150 }], zones, 600)
    expect(activeMinutesFromZoneSeconds(run)).toBe(20)
  })

  it('is inclusive at the floor and excludes the bpm below it', () => {
    const at = accumulateZoneSeconds([{ timestamp: t(0), bpm: 106 }, { timestamp: t(1), bpm: 106 }], zones)
    expect(at[1]).toBeCloseTo(60, 5)
    const below = accumulateZoneSeconds([{ timestamp: t(0), bpm: 105 }, { timestamp: t(1), bpm: 105 }], zones)
    expect(below[1]).toBe(0)
    expect(below[0]).toBeCloseTo(60, 5)
  })
})
