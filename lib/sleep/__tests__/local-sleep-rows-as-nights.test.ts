import { describe, it, expect } from 'vitest'
import { localSleepRowsAsNights } from '@/lib/sleep/merge-sessions'
import type { LocalSleepSession } from '@/lib/local-store/types'

// #2414. The cold-open seed for the sleep screens. The case it exists for is BF-115's real date:
// 2026-09-03 held a night and two naps as three BLE rows. Merged correctly it is the 7.67 h night;
// merged with no windows it is a fabricated 11.5 h night; seeded raw it lands on whichever row the
// sheet's find-by-date meets first.
const local = (o: Partial<LocalSleepSession> & { id: string; date: string }): LocalSleepSession => ({
  durationHours: null, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  sleepStart: null, sleepEnd: null, awakHours: null,
  ouraId: null, efficiency: null, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null,
  lowestHeartRate: null, restlessPeriods: null, sleepScore: null, respiratoryRate: null,
  sleepPhase5Min: null, timeInBedHours: null, manualSleepStart: null,
  syncStatus: 'synced', updatedAt: '2026-09-03T21:00:00.000Z',
  ...o,
})

// Brisbane (UTC+10) windows from the BF-115 investigation, as UTC.
const night = { id: 'n', date: '2026-09-03', ouraId: 'ble:51136441', durationHours: 7.67, deepSleepHours: 1.2, awakHours: 0.4, sleepPhase5Min: '1'.repeat(97) }
const nap1  = { id: 'a', date: '2026-09-03', ouraId: 'ble:51614985', durationHours: 2.0,  deepSleepHours: 0.3, awakHours: 0.1, sleepPhase5Min: '2'.repeat(29) }
const nap2  = { id: 'b', date: '2026-09-03', ouraId: 'ble:51827985', durationHours: 1.83, deepSleepHours: 0.25, awakHours: 0.1, sleepPhase5Min: '3'.repeat(26) }
const nightWin = { sleepStart: '2026-09-02T12:16:00.000Z', sleepEnd: '2026-09-02T20:21:00.000Z' }
const nap1Win  = { sleepStart: '2026-09-03T01:33:00.000Z', sleepEnd: '2026-09-03T03:58:00.000Z' }
const nap2Win  = { sleepStart: '2026-09-03T07:28:00.000Z', sleepEnd: '2026-09-03T09:35:00.000Z' }

describe('localSleepRowsAsNights (#2414)', () => {
  it('a fully timed date reduces to the night, with its window and phase string — the hypnogram inputs', () => {
    // Naps listed first, as the store's date-only ORDER BY may return them.
    const out = localSleepRowsAsNights([
      local({ ...nap1, ...nap1Win }), local({ ...nap2, ...nap2Win }), local({ ...night, ...nightWin }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].durationHours).toBe(7.67)
    expect(out[0].sleepStart).toBe(nightWin.sleepStart)
    expect(out[0].sleepEnd).toBe(nightWin.sleepEnd)
    expect(out[0].sleepPhase5Min).toHaveLength(97)
    expect(out[0].awakHours).toBe(0.4)
  })

  it('never sums an untimed date: rows from before SQLite v50 pass through raw, exactly as before', () => {
    const rows = [local(nap1), local(nap2), local(night)]
    const out = localSleepRowsAsNights(rows)
    expect(out).toHaveLength(3)
    expect(out.map(r => r.durationHours)).toEqual([2.0, 1.83, 7.67]) // store order kept, nothing added
    expect(Math.max(...out.map(r => r.durationHours ?? 0))).toBe(7.67) // no 11.5 h night
    expect(out.every(r => r.sleepStart === null && r.sleepEnd === null)).toBe(true)
  })

  it('a date mixing a timed and an untimed row is also left raw — one untimed row disables clustering', () => {
    const out = localSleepRowsAsNights([local({ ...night, ...nightWin }), local(nap1)])
    expect(out).toHaveLength(2)
    expect(out.map(r => r.durationHours)).toEqual([7.67, 2.0])
  })

  it('a single untimed row is unchanged, including a zero-duration one the route would drop', () => {
    const out = localSleepRowsAsNights([local({ id: 'z', date: '2026-09-01', durationHours: 0 })])
    expect(out).toHaveLength(1)
    expect(out[0].durationHours).toBe(0)
  })

  it('returns newest first, as /api/sleep-sessions does — the store returns oldest first', () => {
    const out = localSleepRowsAsNights([
      local({ id: '1', date: '2026-09-01', durationHours: 7 }),
      local({ id: '2', date: '2026-09-02', durationHours: 7.5, sleepStart: '2026-09-01T12:00:00.000Z', sleepEnd: '2026-09-01T19:30:00.000Z' }),
      local({ id: '3', date: '2026-09-03', durationHours: 8 }),
    ])
    expect(out.map(r => r.date)).toEqual(['2026-09-03', '2026-09-02', '2026-09-01'])
  })

  it('carries no recommendation or provisional flag the local table does not hold', () => {
    const [r] = localSleepRowsAsNights([local({ ...night, ...nightWin })])
    expect(r.sleepTimeRecommendation).toBeNull()
    expect('provisional' in r).toBe(false)
  })
})
