import { describe, expect, it } from 'vitest'
import { stressOverlay } from '../hr-stress-overlay'

const TZ = 'Australia/Brisbane'

/** Brisbane is UTC+10 with no DST, so a local hour maps to a fixed epoch without a library. */
function at(hour: number, minute = 0): number {
  return Date.UTC(2026, 8, 20, hour - 10, minute)
}

describe('stressOverlay', () => {
  it('places a bucket at its local minute-of-day, not the device\'s', () => {
    const { points } = stressOverlay([{ t: at(6, 30), level: -0.4 }], TZ)
    expect(points).toEqual([{ x: 390, y: -0.4 }])
  })

  it('keeps a run contiguous with no breaks inside it', () => {
    const { points } = stressOverlay([
      { t: at(6, 0), level: 0.1 },
      { t: at(6, 30), level: -0.2 },
      { t: at(7, 0), level: -0.5 },
    ], TZ)
    expect(points.map(p => p.y)).toEqual([0.1, -0.2, -0.5])
    expect(points.every(p => p.y !== null)).toBe(true)
  })

  it('breaks the line across a real gap — the measured 06:45 to 13:15 hole', () => {
    const { points } = stressOverlay([
      { t: at(6, 15), level: -0.3 },
      { t: at(6, 45), level: -0.4 },
      { t: at(13, 15), level: 0.2 },
      { t: at(13, 45), level: 0.3 },
    ], TZ)
    const nulls = points.filter(p => p.y === null)
    expect(nulls).toHaveLength(1)
    // The break sits at the start of the run it precedes, so the gap is empty rather than
    // back-filled toward the earlier run.
    expect(nulls[0].x).toBe(13 * 60 + 15)
    expect(points.map(p => p.y)).toEqual([-0.3, -0.4, null, 0.2, 0.3])
  })

  it('tolerates one dropped reading without breaking — 60 minutes is under the 75 threshold', () => {
    const { points } = stressOverlay([
      { t: at(9, 0), level: 0 },
      { t: at(10, 0), level: -0.1 },
    ], TZ)
    expect(points.filter(p => p.y === null)).toHaveLength(0)
  })

  it('never leads or trails with a null, which would shift the whole series', () => {
    const { points } = stressOverlay([
      { t: at(1, 0), level: 0.5 },
      { t: at(20, 0), level: -0.5 },
    ], TZ)
    expect(points[0].y).not.toBeNull()
    expect(points[points.length - 1].y).not.toBeNull()
  })

  it('counts measured buckets and excludes the separators', () => {
    const o = stressOverlay([
      { t: at(2, 0), level: 0 },
      { t: at(12, 0), level: 0 },
      { t: at(22, 0), level: 0 },
    ], TZ)
    expect(o.measured).toBe(3)
    expect(o.points).toHaveLength(5) // three readings, two breaks
  })

  it('sorts a back-filled day so the line cannot double back on itself', () => {
    const { points } = stressOverlay([
      { t: at(15, 0), level: -0.2 },
      { t: at(8, 0), level: 0.4 },
    ], TZ)
    const xs = points.map(p => p.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('returns nothing for a day with no buckets rather than an empty-looking line', () => {
    const o = stressOverlay([], TZ)
    expect(o.points).toEqual([])
    expect(o.measured).toBe(0)
  })

  it('keeps a level of exactly 0 as a reading, not as a gap', () => {
    const { points } = stressOverlay([{ t: at(11, 0), level: 0 }], TZ)
    expect(points).toEqual([{ x: 660, y: 0 }])
  })

  it('reads the caller\'s timezone — the same instant lands on a different minute', () => {
    const bucket = [{ t: at(0, 30), level: -0.1 }]
    expect(stressOverlay(bucket, TZ).points[0].x).toBe(30)
    // UTC is ten hours behind, so 00:30 Brisbane is 14:30 the previous day.
    expect(stressOverlay(bucket, 'UTC').points[0].x).toBe(14 * 60 + 30)
  })
})
