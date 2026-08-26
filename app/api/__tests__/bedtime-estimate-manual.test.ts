// Q-519 — the number this feature exists to protect.
//
// The owner forgot the ring and fitted it at ~4 am. `minutesFromNoon(04:23)` is 983 against ~660 for
// an 11 pm bedtime, so **one such night moves the 14-day mean by ~23 minutes for a fortnight** — and
// the estimate is what pre-fills bedtime everywhere. This is the only route that reads
// `manualSleepStart`, and these pin both halves of that: it uses the remembered value, and the
// measured window it did not touch is still what everything else sees.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({ sleep: [] as Record<string, unknown>[] }))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ listSleepSessions: async () => repo.sleep }),
}))

import { GET } from '@/app/api/user/bedtime-estimate/route'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const today = todayInTz(TZ)
const day = (back: number) => shiftDateStr(today, -back)

/** A night starting at `hourLocal` Brisbane on the evening before `date`, ending 07:00. */
function night(back: number, hourLocal: number, over: Record<string, unknown> = {}) {
  const wake = day(back)
  const bed = day(back + 1)
  // Brisbane is UTC+10 with no DST, so 23:00 local is 13:00Z the same day.
  const utcHour = (hourLocal - 10 + 24) % 24
  // Both timestamps sit on `bed`'s UTC day: 23:00 local is 13:00Z, and 07:00 local the next morning
  // is 21:00Z the same UTC day. Putting the end on `wake`'s UTC day would be 07:00 the day AFTER the
  // wake date — an off-by-one that reads as a plausible fixture and silently drops every night.
  return {
    date: wake,
    sleepStart: new Date(`${bed}T${String(utcHour).padStart(2, '0')}:00:00.000Z`),
    sleepEnd:   new Date(`${bed}T21:00:00.000Z`),
    durationHours: 8,
    ...over,
  }
}

const estimate = async () => await (await GET()).json()

beforeEach(() => { repo.sleep = [] })

describe('GET /api/user/bedtime-estimate with a remembered bedtime (Q-519)', () => {
  it('reads 23:00 from thirteen ordinary nights', async () => {
    repo.sleep = Array.from({ length: 13 }, (_, i) => night(i + 1, 23))
    expect(await estimate()).toEqual({ bedtimeHour: 23, bedtimeMinute: 0 })
  })

  // The reported problem, reproduced.
  it('a single 4 am ring-fitting drags the estimate ~23 minutes later', async () => {
    repo.sleep = [
      ...Array.from({ length: 13 }, (_, i) => night(i + 1, 23)),
      { ...night(0, 23), sleepStart: new Date(`${day(0)}T18:23:00.000Z`) },  // 04:23 local on the wake day
    ]
    const { bedtimeHour, bedtimeMinute } = await estimate()
    const drift = (bedtimeHour * 60 + bedtimeMinute) - 23 * 60
    expect(drift).toBeGreaterThanOrEqual(20)
    expect(drift).toBeLessThanOrEqual(26)
  })

  // …and repaired, without the measured window moving.
  it('the remembered bedtime removes the drift entirely', async () => {
    const lateFit = {
      ...night(0, 23),
      sleepStart: new Date(`${day(0)}T18:23:00.000Z`),          // still 04:23 — untouched
      manualSleepStart: new Date(`${day(1)}T13:00:00.000Z`),    // 23:00 the evening before
    }
    repo.sleep = [...Array.from({ length: 13 }, (_, i) => night(i + 1, 23)), lateFit]
    expect(await estimate()).toEqual({ bedtimeHour: 23, bedtimeMinute: 0 })
    // The row the route read is unchanged — this route substitutes at read time and writes nothing.
    expect(lateFit.sleepStart).toEqual(new Date(`${day(0)}T18:23:00.000Z`))
  })

  it('uses the remembered value on its own night only', async () => {
    repo.sleep = [
      ...Array.from({ length: 12 }, (_, i) => night(i + 2, 23)),
      night(1, 23),
      { ...night(0, 23), sleepStart: new Date(`${day(0)}T18:23:00.000Z`),
        manualSleepStart: new Date(`${day(1)}T12:00:00.000Z`) },   // 22:00 — earlier than the rest
    ]
    const { bedtimeHour, bedtimeMinute } = await estimate()
    // One 22:00 night in fourteen pulls the mean a few minutes earlier, not an hour.
    const drift = 23 * 60 - (bedtimeHour * 60 + bedtimeMinute)
    expect(drift).toBeGreaterThan(0)
    expect(drift).toBeLessThan(10)
  })

  it('ignores it when it is null, rather than treating null as midnight', async () => {
    repo.sleep = Array.from({ length: 13 }, (_, i) => ({ ...night(i + 1, 23), manualSleepStart: null }))
    expect(await estimate()).toEqual({ bedtimeHour: 23, bedtimeMinute: 0 })
  })

  it('still falls back to 22:00 with no nights at all', async () => {
    expect(await estimate()).toEqual({ bedtimeHour: 22, bedtimeMinute: 0 })
  })
})
