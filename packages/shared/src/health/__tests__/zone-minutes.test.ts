import { describe, it, expect } from 'vitest'
import { computeHrZones } from '../hr-zones'
import { accumulateZoneSeconds, edwardsTrimp, zoneBreakdownFromReadings, activeMinutesFromZoneSeconds } from '../zone-minutes'

// Profile: maxHr 190, restingHr 50 → reserve 140. Zone lower bpms:
// Z1 50, Z2 50+0.6*140=134, Z3 50+0.7*140=148, Z4 50+0.8*140=162, Z5 50+0.9*140=176
const zones = computeHrZones({ maxHr: 190, restingHr: 50 })

const t = (min: number) => new Date(Date.UTC(2026, 6, 17, 15, 0, 0) + min * 60_000).getTime()

describe('accumulateZoneSeconds', () => {
  it('attributes the gap to the zone of the earlier reading', () => {
    // 100 bpm (Z1) for 1 min, then 150 bpm (Z3) for 1 min, then a trailing sample.
    const readings = [
      { timestamp: t(0), bpm: 100 },
      { timestamp: t(1), bpm: 150 },
      { timestamp: t(2), bpm: 150 },
    ]
    const secs = accumulateZoneSeconds(readings, zones)
    expect(secs[0]).toBeCloseTo(60, 5) // Z1: first 60s
    expect(secs[2]).toBeCloseTo(60, 5) // Z3: second 60s
    expect(secs[1]).toBe(0)
    expect(secs[3]).toBe(0)
  })

  it('caps a large data gap at maxGapSec (idle / no-data stretch)', () => {
    const readings = [
      { timestamp: t(0), bpm: 140 },     // Z2
      { timestamp: t(60), bpm: 140 },    // 1h gap → capped to 120s
    ]
    const secs = accumulateZoneSeconds(readings, zones, 120)
    expect(secs[1]).toBe(120)
  })

  it('returns all-zero for <2 readings', () => {
    expect(accumulateZoneSeconds([], zones)).toEqual([0, 0, 0, 0, 0])
    expect(accumulateZoneSeconds([{ timestamp: t(0), bpm: 140 }], zones)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('edwardsTrimp', () => {
  it('sums minutes-in-zone weighted by zone number (1..5)', () => {
    // 60s Z1, 120s Z3, 60s Z5 → 1*1 + 2*3 + 1*5 = 12
    expect(edwardsTrimp([60, 0, 120, 0, 60])).toBeCloseTo(1 * 1 + 2 * 3 + 1 * 5, 5)
  })
  it('is zero for an empty session', () => {
    expect(edwardsTrimp([0, 0, 0, 0, 0])).toBe(0)
  })
})

describe('zoneBreakdownFromReadings', () => {
  it('returns per-zone seconds, percentages, total, and Session Load', () => {
    const readings = [
      { timestamp: t(0), bpm: 100 },  // Z1 60s
      { timestamp: t(1), bpm: 150 },  // Z3 60s
      { timestamp: t(2), bpm: 150 },
    ]
    const b = zoneBreakdownFromReadings(readings, zones)
    expect(b.totalSec).toBeCloseTo(120, 5)
    expect(b.zones[0].seconds).toBeCloseTo(60, 5)
    expect(b.zones[2].seconds).toBeCloseTo(60, 5)
    expect(b.zones[0].pct).toBeCloseTo(50, 1)
    expect(b.sessionLoad).toBe(Math.round(1 * 1 + 1 * 3))
  })
})

describe('activeMinutesFromZoneSeconds', () => {
  it('counts Zone 2 (moderate) minutes once', () => {
    // 600s (10min) in Zone 2 only.
    expect(activeMinutesFromZoneSeconds([0, 600, 0, 0, 0])).toBe(10)
  })
  it('counts Zone 3+ (vigorous) minutes double, per the WHO 2020 guideline', () => {
    // 300s (5min) in Zone 3 → 5 * 2 = 10 "active minutes".
    expect(activeMinutesFromZoneSeconds([0, 0, 300, 0, 0])).toBe(10)
  })
  it('sums moderate + double-counted vigorous together', () => {
    // 10min Zone 2 (moderate, x1) + 5min Zone 4 (vigorous, x2) = 10 + 10 = 20.
    expect(activeMinutesFromZoneSeconds([0, 600, 0, 300, 0])).toBe(20)
  })
  it('ignores Zone 1 (below moderate)', () => {
    expect(activeMinutesFromZoneSeconds([600, 0, 0, 0, 0])).toBe(0)
  })
  it('is zero for an all-zero day', () => {
    expect(activeMinutesFromZoneSeconds([0, 0, 0, 0, 0])).toBe(0)
  })
})
