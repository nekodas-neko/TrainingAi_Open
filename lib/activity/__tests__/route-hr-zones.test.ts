import { describe, it, expect } from 'vitest'
import { buildRouteZoneSegments } from '../route-hr-zones'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'

// resting 60, max 180 → reserve 120. Zone bounds (rounded): Z1 [60,132) Z2 [132,144) Z3 [144,156)
// Z4 [156,168) Z5 [168,∞).
const zones = computeHrZones({ maxHr: 180, restingHr: 60 })

describe('buildRouteZoneSegments', () => {
  it('returns null when there is neither a pace series nor an end time', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const result = buildRouteZoneSegments({
      points, paceSeries: [], hrReadings: [{ timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 }],
      zones, startTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).toBeNull()
  })

  it('falls back to a constant-pace model (start/end time only) when there is no pace series', () => {
    // A straight line, no pace series, but a 2-minute duration and HR ramping from Z1 to Z5 —
    // the fallback should still color the start Z1 and the end Z5 using the assumed-constant
    // pace across the whole route.
    const points = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.002 }, { lat: 0, lng: 0.003 },
    ]
    const hrReadings = [
      { timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 },
      { timestamp: '2026-01-01T00:00:30.000Z', bpm: 100 },
      { timestamp: '2026-01-01T00:01:30.000Z', bpm: 175 },
      { timestamp: '2026-01-01T00:02:00.000Z', bpm: 175 },
    ]
    const result = buildRouteZoneSegments({
      points, paceSeries: [], hrReadings, zones,
      startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:02:00.000Z',
    })
    expect(result).not.toBeNull()
    expect(result![0].color).toBe(zones[0].color) // Z1 at the start
    expect(result![result!.length - 1].color).toBe(zones[4].color) // Z5 at the end
  })

  it('returns null for the fallback when start and end time are identical (zero duration)', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const result = buildRouteZoneSegments({
      points, paceSeries: [], hrReadings: [{ timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 }],
      zones, startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).toBeNull()
  })

  it('returns null when there are no HR readings', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const result = buildRouteZoneSegments({
      points, paceSeries: [{ tSec: 60, paceSec: 300 }], hrReadings: [],
      zones, startTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).toBeNull()
  })

  it('returns null for fewer than 2 points', () => {
    const result = buildRouteZoneSegments({
      points: [{ lat: 0, lng: 0 }],
      paceSeries: [{ tSec: 60, paceSec: 300 }],
      hrReadings: [{ timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 }],
      zones, startTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).toBeNull()
  })

  it('colors a whole flat-effort route in a single zone as one run', () => {
    // A straight line, constant pace, and one HR reading well inside Z1 (100 bpm) for the
    // whole activity — every segment should classify the same zone and merge into one run.
    const points = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.002 }, { lat: 0, lng: 0.003 },
    ]
    const paceSeries = [{ tSec: 120, paceSec: 300 }]
    const hrReadings = [
      { timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 },
      { timestamp: '2026-01-01T00:02:00.000Z', bpm: 100 },
    ]
    const result = buildRouteZoneSegments({
      points, paceSeries, hrReadings, zones, startTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0].color).toBe(zones[0].color) // Z1
    expect(result![0].positions).toEqual(points)
  })

  it('splits into separate runs when bpm crosses a zone boundary partway through', () => {
    // Same route, but HR ramps from Z1 (100 bpm) at t=0 to Z5 (175 bpm) by the end.
    const points = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.002 }, { lat: 0, lng: 0.003 },
    ]
    const paceSeries = [{ tSec: 120, paceSec: 300 }]
    const hrReadings = [
      { timestamp: '2026-01-01T00:00:00.000Z', bpm: 100 },
      { timestamp: '2026-01-01T00:00:30.000Z', bpm: 100 },
      { timestamp: '2026-01-01T00:01:30.000Z', bpm: 175 },
      { timestamp: '2026-01-01T00:02:00.000Z', bpm: 175 },
    ]
    const result = buildRouteZoneSegments({
      points, paceSeries, hrReadings, zones, startTime: '2026-01-01T00:00:00.000Z',
    })
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(1)
    expect(result![0].color).toBe(zones[0].color) // Z1 at the start
    expect(result![result!.length - 1].color).toBe(zones[4].color) // Z5 at the end
    // Runs share their boundary point so the drawn line has no gaps.
    for (let i = 1; i < result!.length; i++) {
      expect(result![i].positions[0]).toEqual(result![i - 1].positions[result![i - 1].positions.length - 1])
    }
  })
})
