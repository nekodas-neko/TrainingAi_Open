// #2439 — `daily_zone_minutes` caches a past day's time-in-zone the first time it is read and trusts
// it afterwards. Of the three heart-rate writers, the BLE rollup and Health Connect drop the cached
// days their new data touches; the chest strap did not, and it accepts samples up to seven days old.
// So a strap backlog for an earlier day (phone offline overnight, then a flush) arriving after that
// day was read left the old split in place for good. A ring user never saw it: the rollup wipes the
// last 14 cached days on every pass.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = { user: { id: 'u1', timezone: 'Australia/Brisbane' } as { id: string; timezone?: string } }
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session) }))
const calls: string[] = []
const upsertOuraHeartrate = vi.fn(async () => { calls.push('upsert') })
const insertRrIntervals = vi.fn(async () => {})
const dropZoneMinutesFrom = vi.fn<(userId: string, fromDay: string) => Promise<void>>(async () => { calls.push('drop') })
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ upsertOuraHeartrate, insertRrIntervals, dropZoneMinutesFrom })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

import { POST } from '@/app/api/hr-ingest/route'

const post = (body: unknown) => POST(new Request('http://x/api/hr-ingest', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

// Fixed-offset zones, so the day a sample lands on cannot move with a tz-database update.
// 2h ago is always inside the ±window; the day it falls on is derived from the clock, not written down.
const BRISBANE = 'Etc/GMT-10'   // UTC+10
const NEW_YORK = 'Etc/GMT+5'    // UTC-5
const dayIn = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms))

describe('POST /api/hr-ingest drops the cached zone minutes its samples touch (#2439)', () => {
  beforeEach(() => {
    calls.length = 0
    upsertOuraHeartrate.mockClear(); insertRrIntervals.mockClear(); dropZoneMinutesFrom.mockClear()
    session.user.timezone = 'Australia/Brisbane'
  })

  it('drops cached days from the earliest stored sample\'s local day, after the write', async () => {
    const earliest = Date.now() - 3 * 86_400_000
    session.user.timezone = BRISBANE
    await post({ samples: [{ at: Date.now() - 60_000, bpm: 130 }, { at: earliest, bpm: 128 }, { at: earliest + 5_000, bpm: 129 }] })
    expect(dropZoneMinutesFrom).toHaveBeenCalledTimes(1)
    expect(dropZoneMinutesFrom).toHaveBeenCalledWith('u1', dayIn(earliest, BRISBANE))
    // The cache is dropped AFTER the rows land: dropping first would let a read in between
    // recompute the day from the data that is about to be replaced.
    expect(calls).toEqual(['upsert', 'drop'])
  })

  it('names the day in the USER\'s zone, not the server\'s or the device\'s', async () => {
    // Pick an instant whose calendar day differs between UTC+10 and UTC-5 (their gap is 15 h).
    const base = new Date(); base.setUTCHours(16, 0, 0, 0)
    const at = base.getTime() - 2 * 86_400_000
    expect(dayIn(at, BRISBANE)).not.toBe(dayIn(at, NEW_YORK))
    for (const tz of [BRISBANE, NEW_YORK]) {
      dropZoneMinutesFrom.mockClear(); session.user.timezone = tz
      await post({ samples: [{ at, bpm: 125 }] })
      expect(dropZoneMinutesFrom).toHaveBeenCalledWith('u1', dayIn(at, tz))
    }
  })

  it('ignores a sample that was not stored: out of band, or out of window', async () => {
    const stored = Date.now() - 2 * 86_400_000
    await post({ samples: [
      { at: Date.now() - 20 * 86_400_000, bpm: 120 },   // beyond the 7-day tolerance, dropped
      { at: Date.now() - 4 * 86_400_000, bpm: 0 },      // bpm out of band, dropped
      { at: stored, bpm: 126 },
    ] })
    expect(dropZoneMinutesFrom).toHaveBeenCalledWith('u1', dayIn(stored, 'Australia/Brisbane'))
  })

  it('does nothing when nothing was stored', async () => {
    await post({ samples: [{ at: Date.now() - 60_000, bpm: 0 }, { at: Date.now() - 60_000, bpm: 300 }] })
    expect(upsertOuraHeartrate).not.toHaveBeenCalled()
    expect(dropZoneMinutesFrom).not.toHaveBeenCalled()
  })

  it('falls back to the default zone when the profile has none', async () => {
    delete session.user.timezone
    const at = Date.now() - 2 * 86_400_000
    await post({ samples: [{ at, bpm: 126 }] })
    expect(dropZoneMinutesFrom).toHaveBeenCalledWith('u1', dayIn(at, 'Australia/Brisbane'))
  })
})
