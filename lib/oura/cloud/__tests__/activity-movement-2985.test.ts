// #2985 (#2981): Oura's MET series as rung 1 of `MET/min`, next to the ring's own grid. Fixtures are
// anchored to local midday on a Brisbane day; Oura's activity day starts at 4 a.m. local. Since #3597
// the Oura fields are mapped by the connector (`ouraActivityMovementSeries`) and gridded by the
// generic `perMinuteMovementGrid`; these assertions are unchanged from before that split.
import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { perMinuteMovementGrid } from '@trainingai/shared/health/per-minute-movement'
import { deviceMetGrid, resolveDayMetPerMinute } from '@trainingai/shared/health/met-input'
import { ouraActivityMovementSeries, type OuraActivitySeriesDay } from '../activity-movement'

/** Oura's rows to the per-minute grid, the way every reader now builds it. */
const ouraGrid = (days: readonly OuraActivitySeriesDay[], fromMs: number, toMs: number) =>
  perMinuteMovementGrid(ouraActivityMovementSeries(days), fromMs, toMs)

const TZ = 'Australia/Brisbane'
const DAY = '2026-10-18'
const midnight = dateStrMidnightInTz(DAY, TZ).getTime()
const at = (h: number, m = 0) => midnight + (h * 60 + m) * 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const DAY_END = midnight + 86_400_000

/** A series of `n` items every `intervalSec` from `startMs`, all `value`. */
const series = (startMs: number, n: number, value: number | null, intervalSec = 60) =>
  ({ interval: intervalSec, items: Array.from({ length: n }, () => value), timestamp: iso(startMs) })

describe('Oura\'s MET as a per-minute movement grid (#2985)', () => {
  it('places a 60-second series one item per minute, by its own timestamp', () => {
    const grid = ouraGrid([{ met: series(at(12), 3, 2.5), class5Min: null }], midnight, DAY_END)
    expect(grid.startTimestampMs).toBe(midnight)
    expect(grid.metsPerMinute).toHaveLength(1440)
    expect(grid.metsPerMinute[12 * 60]).toBe(2.5)
    expect(grid.metsPerMinute[12 * 60 + 2]).toBe(2.5)
    expect(grid.metsPerMinute[12 * 60 + 3]).toBeNull()
    expect(grid.metsPerMinute.filter(v => v != null)).toHaveLength(3)
  })

  it('fills the day\'s first four hours from the Oura day before, which starts at 4 a.m.', () => {
    const before = { met: series(at(-20), 24 * 60, 1.1), class5Min: null }  // 04:00 the day before
    const today = { met: series(at(4), 24 * 60, 1.3), class5Min: null }
    const grid = ouraGrid([before, today], midnight, DAY_END)
    expect(grid.metsPerMinute[0]).toBe(1.1)
    expect(grid.metsPerMinute[4 * 60 - 1]).toBe(1.1)
    expect(grid.metsPerMinute[4 * 60]).toBe(1.3)
    expect(grid.metsPerMinute.every(v => v != null)).toBe(true)
  })

  it('gives each minute of a coarser item that item\'s value, and averages a finer series', () => {
    const coarse = ouraGrid([{ met: series(at(12), 2, 3, 300), class5Min: null }], midnight, DAY_END)
    expect(coarse.metsPerMinute.slice(12 * 60, 12 * 60 + 11)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, null])
    const fine = ouraGrid([{ met: { interval: 30, items: [2, 4], timestamp: iso(at(12)) }, class5Min: null }], midnight, DAY_END)
    expect(fine.metsPerMinute[12 * 60]).toBe(3)
  })

  it('never invents a value: a null item stays a gap, and an empty day is all gaps', () => {
    const grid = ouraGrid([{ met: { interval: 60, items: [2, null, 2], timestamp: iso(at(12)) }, class5Min: null }], midnight, DAY_END)
    expect(grid.metsPerMinute.slice(12 * 60, 12 * 60 + 3)).toEqual([2, null, 2])
    expect(ouraGrid([], midnight, DAY_END).metsPerMinute.every(v => v == null)).toBe(true)
    expect(ouraGrid([{ met: null, class5Min: '000' }], midnight, DAY_END).metsPerMinute.every(v => v == null)).toBe(true)
  })

  it('wear gate: a non-wear 5-minute slot leaves its minutes missing, never rest', () => {
    // From 04:00: slot 0 rest, slot 1 non-wear, slot 2 rest.
    const grid = ouraGrid([{ met: series(at(4), 15, 0.9), class5Min: '101' }], midnight, DAY_END)
    expect(grid.metsPerMinute.slice(4 * 60, 4 * 60 + 15)).toEqual([
      0.9, 0.9, 0.9, 0.9, 0.9, null, null, null, null, null, 0.9, 0.9, 0.9, 0.9, 0.9,
    ])
    // And nothing lower in the cascade turns the gap into rest on its own.
    const met = resolveDayMetPerMinute({
      ringGrid: { startTimestampMs: 0, metsPerMinute: [] }, movementGrid: grid,
      ringStillFramesMs: [], sleepSessions: [], activities: [],
    }, midnight, DAY_END)
    expect(met.metsPerMinute[4 * 60 + 5]).toBeNull()
    expect(met.mix).toMatchObject({ provided: 10, missing: 1430 })
  })
})

describe('MET/min rung 1: the ring and Oura together (#2985)', () => {
  const ringGrid = { startTimestampMs: at(12), metsPerMinute: [4, 4] }
  const movementGrid = ouraGrid([{ met: series(at(12), 3, 1.5), class5Min: null }], midnight, DAY_END)

  it('a ring minute beats an Oura minute; Oura fills the minutes the ring lacks', () => {
    const met = resolveDayMetPerMinute({ ringGrid, movementGrid, ringStillFramesMs: [], sleepSessions: [], activities: [] }, midnight, DAY_END)
    expect(met.metsPerMinute.slice(12 * 60, 12 * 60 + 3)).toEqual([4, 4, 1.5])
    expect(met.series[12 * 60].provenance?.source).toBe('oura_ble')
    expect(met.series[12 * 60 + 2].provenance).toMatchObject({ source: 'oura_cloud', rung: 'provided', route: 'device_met' })
  })

  it('walk detection reads the same rung: the ring first, then Oura', () => {
    const grid = deviceMetGrid(ringGrid, movementGrid, midnight, DAY_END)
    expect(grid.startTimestampMs).toBe(midnight)
    expect(grid.metsPerMinute.slice(12 * 60, 12 * 60 + 4)).toEqual([4, 4, 1.5, null])
  })
})
