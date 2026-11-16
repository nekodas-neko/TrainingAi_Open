import { describe, it, expect } from 'vitest'
import { computeHrZones } from '../hr-zones'
import {
  accumulateZoneSeconds, activeMinutesFromReadings, creditedGapSec, ACTIVITY_WINDOW_MAX_GAP_SEC,
  DEFAULT_MAX_GAP_SEC, HR_DENSE_MAX_GAP_MS,
} from '../zone-minutes'
import { HR_DENSE_MAX_GAP_MS as REEXPORTED } from '../intraday-hr-contributors'
import { activityHrWindows } from '../activity-hr-windows'
import { heartHealthMinutes } from '../../running/heart-health'
import { scoreActivityForDay } from '../activity-day'

// #3775 item 3 (owner, 16 Nov 2026): inside a workout or activity window a heart-rate gap counts
// up to 5½ min; every other gap keeps the 2-minute cap.

const MIN = 60_000
// Local midday anchors, so a window never sits on a day edge.
const T0 = Date.UTC(2026, 10, 10, 2, 0, 0) // 12:00 in Brisbane
const at = (min: number) => T0 + min * MIN
const win = (fromMin: number, toMin: number) => ({ fromMs: at(fromMin), toMs: at(toMin) })

describe('#3775 creditedGapSec — the one gap rule', () => {
  it('the inside cap is the density rule’s 5½ minutes, defined once', () => {
    expect(ACTIVITY_WINDOW_MAX_GAP_SEC).toBe(330)
    expect(HR_DENSE_MAX_GAP_MS).toBe(330_000)
    expect(REEXPORTED).toBe(HR_DENSE_MAX_GAP_MS)
    expect(DEFAULT_MAX_GAP_SEC).toBe(120)
  })

  it('outside every window a gap keeps the 2-minute cap', () => {
    expect(creditedGapSec(at(0), at(5))).toBe(120)
    expect(creditedGapSec(at(0), at(5), { windows: [win(30, 60)] })).toBe(120)
    expect(creditedGapSec(at(0), at(1))).toBe(60)
  })

  it('wholly inside a window a gap counts in full up to 5½ min', () => {
    expect(creditedGapSec(at(10), at(15), { windows: [win(0, 60)] })).toBe(300)
    expect(creditedGapSec(at(10), at(15.5), { windows: [win(0, 60)] })).toBe(330)
    expect(creditedGapSec(at(10), at(30), { windows: [win(0, 60)] })).toBe(120) // over 5½ min: the ring was off, 2 min as before
    expect(creditedGapSec(at(10), at(16), { windows: [win(0, 60)] })).toBe(120)
    expect(creditedGapSec(at(10), at(15), { windows: 'all' })).toBe(300)
  })

  it('across a window edge: the part inside at 5½, the rest at 2', () => {
    // 5 min gap, 1 min inside, 4 outside → 60 + 120.
    expect(creditedGapSec(at(0), at(5), { windows: [win(4, 60)] })).toBe(180)
    // 5 min gap, 4 min inside, 1 outside → 240 + 60.
    expect(creditedGapSec(at(0), at(5), { windows: [win(1, 60)] })).toBe(300)
    // A gap over 5½ min keeps the 2-minute cap, inside or across a window.
    expect(creditedGapSec(at(0), at(20), { windows: [win(10, 60)] })).toBe(120)
  })

  it('overlapping windows are not counted twice', () => {
    expect(creditedGapSec(at(0), at(5), { windows: [win(0, 3), win(1, 4)] })).toBe(240 + 60)
  })

  it('a non-positive gap credits nothing', () => {
    expect(creditedGapSec(at(5), at(5), { windows: 'all' })).toBe(0)
    expect(creditedGapSec(at(5), at(4), { windows: 'all' })).toBe(0)
  })
})

describe('#3775 every series roll-up reads the same rule', () => {
  const zones = computeHrZones({ maxHr: 190, restingHr: 50 })
  // An Oura Cloud-like series: a reading every 5 minutes, all day, at 140 bpm (zone 2).
  const series = Array.from({ length: 25 }, (_, i) => ({ timestamp: at(i * 5), bpm: 140 }))
  const workout = [win(20, 60)] // 8 of the 24 gaps inside

  it('zone seconds: gaps inside the workout count in full, the rest at 2 min', () => {
    const secs = accumulateZoneSeconds(series, zones, { windows: workout })
    expect(secs[1]).toBe(8 * 300 + 16 * 120)
    expect(accumulateZoneSeconds(series, zones)[1]).toBe(24 * 120) // no windows: unchanged
  })

  it('WHO active minutes and heart-health minutes move the same way', () => {
    const floors = { moderateFloorBpm: 100, vigorousFloorBpm: 135 }
    expect(activeMinutesFromReadings(series, floors, { windows: workout })).toBe(((8 * 300 + 16 * 120) / 60) * 2)
    expect(heartHealthMinutes(series, 100, { windows: workout })).toBe((8 * 300 + 16 * 120) / 60)
    expect(heartHealthMinutes(series, 100)).toBe(48)
  })
})

describe('#3775 activityHrWindows — a day’s workout and activity windows', () => {
  const tz = 'Australia/Brisbane'

  it('places a finished session and a timed activity log; skips what cannot be placed', () => {
    const w = activityHrWindows({
      sessions: [
        { startedAt: new Date(at(0)), completedAt: new Date(at(45)) },
        { startedAt: new Date(at(100)), completedAt: null }, // still in progress
      ],
      activityLogs: [
        { date: '2026-11-10', startTime: '14:00', endTime: '14:40' },
        { date: '2026-11-10', startTime: null, durationMin: 30 }, // no start: no window
      ],
    }, tz)
    expect(w).toEqual([
      { fromMs: at(0), toMs: at(45) },
      { fromMs: at(120), toMs: at(160) },
    ])
  })
})

describe('#3775 the Activity score reads its day’s windows', () => {
  const tz = 'Australia/Brisbane'
  const hrRows = Array.from({ length: 25 }, (_, i) => ({ timestamp: new Date(at(i * 5)), bpm: 150, source: 'oura_cloud' }))
  const base = {
    date: '2026-11-10', tz, bodyMetrics: [], restingHr: 55, hrRows, maxHr: 185,
    program: null, user: null, stepsGoal: null,
  }

  it('a logged activity over the series lifts zone minutes; without one they keep the 2-minute cap', () => {
    const without = scoreActivityForDay({ ...base, sessions: [] }).signals.zoneMinutes
    const withLog = scoreActivityForDay({
      ...base, sessions: [],
      activityLogs: [{ date: '2026-11-10', activityType: 'run', startTime: '12:00', endTime: '14:00' }],
    }).signals.zoneMinutes
    expect(without).not.toBeNull()
    expect(withLog!).toBeGreaterThan(without!)
  })
})

describe('activityHrWindows keeps only spans the app believes (#3775, #3801)', () => {
  it('a session over 4 hours gives no window; one under does', () => {
    const start = new Date('2026-11-10T07:00:00Z')
    const ok = { startedAt: start, completedAt: new Date(start.getTime() + 60 * 60_000) }
    const tooLong = { startedAt: start, completedAt: new Date(start.getTime() + 12 * 60 * 60_000) }
    expect(activityHrWindows({ sessions: [ok] }, 'Australia/Brisbane')).toHaveLength(1)
    expect(activityHrWindows({ sessions: [tooLong] }, 'Australia/Brisbane')).toEqual([])
  })
})
