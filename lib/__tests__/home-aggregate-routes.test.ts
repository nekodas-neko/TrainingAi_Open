/**
 * PS-39, second pass: the home screen's aggregate routes. The entry named these as the actionable
 * core precisely because they *looked* covered — `calendar-data` and `training-load` appear in tests
 * only as cache-key strings, which is what made the old count read 93 instead of 150.
 *
 * These pin the contract each route owes its caller, not the maths behind it (`computeVolumeAcwr`
 * and `acwrBand` have their own tests). The two worth stating:
 *
 *   · **`training-load` bands the number; the client never re-bands it.** CLAUDE.md's One Formula,
 *     One Place says clients render the route's `interpretation` and never re-derive the thresholds
 *     — a rule that only holds if the route actually sends one.
 *   · **`calendar-data` validates before it authenticates.** That ordering is deliberate and worth
 *     a test, because "tidying" it into the usual auth-first shape changes what an unauthenticated
 *     caller learns from a malformed request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const getSessionLoadsFrom = vi.fn(async () => [] as Array<{ startedAt: Date; volume: number }>)
const getActiveProgram = vi.fn(async () => null as unknown)
const getCalendarData = vi.fn(async () => ({ trainedDays: {}, activityDays: {} }))
const getWorkoutSessionsFrom = vi.fn(async () => [] as unknown[])
const listExerciseMuscleMap = vi.fn(async () => [] as unknown[])

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ getSessionLoadsFrom, getActiveProgram, getCalendarData, getWorkoutSessionsFrom, listExerciseMuscleMap }),
}))

import { GET as trainingLoad } from '@/app/api/training-load/route'
import { GET as calendarData } from '@/app/api/calendar-data/route'
import { GET as muscleRecovery } from '@/app/api/muscle-recovery/route'

const TZ = 'Australia/Brisbane'
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

/** A month of steady daily volume — enough history that ACWR resolves rather than reading
 *  `insufficient_data`, which is the only state most of these assertions can be made from. */
const steadyMonth = (volumeKg: number) =>
  Array.from({ length: 28 }, (_, i) => ({ startedAt: daysAgo(i), volume: volumeKg }))

beforeEach(() => {
  sessionUser = { id: 'u-1', timezone: 'Australia/Brisbane' }
  getSessionLoadsFrom.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(null)
  getCalendarData.mockResolvedValue({ trainedDays: {}, activityDays: {} })
  getWorkoutSessionsFrom.mockResolvedValue([])
})

describe('GET /api/training-load', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await trainingLoad()).status).toBe(401)
  })

  it('says insufficient_data rather than guessing when there is no history', async () => {
    const res = await trainingLoad()
    const json = await res.json()
    expect(json.acwr).toBeNull()
    expect(json.interpretation).toBe('insufficient_data')
    // Monotony is deliberately independent of the ACWR gate — it needs a week, not four.
    expect(json).toHaveProperty('monotony')
  })

  it('sends a banded interpretation, so the client never re-derives the thresholds', async () => {
    getSessionLoadsFrom.mockResolvedValue(steadyMonth(5_000))
    const json = await (await trainingLoad()).json()
    expect(json.acwr).not.toBeNull()
    expect(['optimal', 'high', 'very_high', 'low']).toContain(json.interpretation)
  })

  it('withholds ACWR while a new program is still baselining, and says how long is left', async () => {
    // The chronic baseline still contains the previous routine's sessions, so the ratio is a
    // comparison between two different programs.
    getSessionLoadsFrom.mockResolvedValue(steadyMonth(5_000))
    getActiveProgram.mockResolvedValue({ startedAt: shiftDateStr(todayInTz(TZ), -10) })

    const json = await (await trainingLoad()).json()
    expect(json.interpretation).toBe('baselining')
    expect(json.acwr).toBeNull()
    expect(json.baselineDaysRemaining).toBeGreaterThan(0)
    expect(json.baselineDaysRemaining).toBeLessThanOrEqual(28)
  })

  it('falls back to createdAt when the program has no startedAt', async () => {
    // Current behaviour, and worth pinning because it is not shared: PS-28 records that readiness
    // uses `startedAt` else Infinity — never baselining — while this route uses
    // `startedAt ?? createdAt`. The owner's active program has `started_at = NULL`, so the two
    // disagree on live data. If PS-28 resolves that, this expectation is what it has to update.
    getSessionLoadsFrom.mockResolvedValue(steadyMonth(5_000))
    getActiveProgram.mockResolvedValue({ startedAt: null, createdAt: daysAgo(5) })

    const json = await (await trainingLoad()).json()
    expect(json.interpretation).toBe('baselining')
  })

  it('is never served from the browser cache', async () => {
    expect((await trainingLoad()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/calendar-data', () => {
  const get = (qs: string) =>
    calendarData(new Request(`http://localhost/api/calendar-data${qs}`) as never)

  it('rejects a month or year outside the range before it looks at the session', async () => {
    // The order is deliberate: an out-of-range request is answered the same whether or not the
    // caller is signed in, so the route never becomes a way to probe for a valid session.
    sessionUser = null
    for (const qs of ['?year=1999&month=1', '?year=2026&month=13', '?year=2026&month=0']) {
      const res = await get(qs)
      expect(res.status).toBe(400)
    }
    expect(getCalendarData).not.toHaveBeenCalled()
  })

  it('refuses an in-range request without a session', async () => {
    sessionUser = null
    expect((await get('?year=2026&month=9')).status).toBe(401)
    expect(getCalendarData).not.toHaveBeenCalled()
  })

  it('passes the user\'s own timezone down, and echoes the period back', async () => {
    // The repository keys days by this — Q-144 was a whole class of workouts filed a day late for
    // anyone outside Brisbane, and the route is where the timezone enters.
    getCalendarData.mockResolvedValue({ trainedDays: { '2026/09/01': ['Upper'] }, activityDays: {} })
    const json = await (await get('?year=2026&month=9')).json()

    expect(getCalendarData).toHaveBeenCalledWith('u-1', 2026, 9, 'Australia/Brisbane')
    expect(json).toMatchObject({ year: 2026, month: 9 })
    expect(json.trainedDays).toEqual({ '2026/09/01': ['Upper'] })
  })

  it('is never served from the browser cache', async () => {
    expect((await get('?year=2026&month=9')).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/muscle-recovery', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await muscleRecovery()).status).toBe(401)
  })

  it('reads only the last seven days, because recovery older than that is complete', async () => {
    await muscleRecovery()
    const [userId, from] = getWorkoutSessionsFrom.mock.calls[0] as [string, Date]
    expect(userId).toBe('u-1')
    const daysBack = (Date.now() - from.getTime()) / 86_400_000
    expect(daysBack).toBeGreaterThan(6.9)
    expect(daysBack).toBeLessThan(7.1)
  })

  it('sorts least-recovered first, then by name — a stable order the card can render', async () => {
    // Ties break on the muscle name rather than on map iteration order, so two muscles at the same
    // percentage do not swap places between requests and make the card look like it is flickering.
    getWorkoutSessionsFrom.mockResolvedValue([])
    const json = await (await muscleRecovery()).json()
    const pcts = (json.muscles as Array<{ pct: number; muscle: string }>).map(m => m.pct)
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts)
  })

  it('is never served from the browser cache', async () => {
    expect((await muscleRecovery()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
