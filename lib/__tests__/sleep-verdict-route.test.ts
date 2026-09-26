/**
 * LA-149 — the route that announces the sleep verdict and records the answer.
 *
 * The case that matters most is the one that looks like a caching detail: **a stored verdict is
 * returned, never recomputed.** TN-81 exists so a correction stays paired with the numbers it
 * disagreed with, and a route that recomputes on every read quietly undoes that — the bands would
 * drift under the answer and nothing would look wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getSleepVerdict = vi.fn(async (_u: string, _d: string) => null as Row | null)
const upsertSleepVerdict = vi.fn(async (_u: string, _r: Row) => undefined)
const setSleepVerdictResponse = vi.fn(async (_u: string, _d: string, _s: string) => true)
const listSleepSessions = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const saveDayCheckin = vi.fn(async (..._a: unknown[]) => ({}) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getSleepVerdict, upsertSleepVerdict, setSleepVerdictResponse, listSleepSessions, saveDayCheckin,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET, POST } from '@/app/api/sleep-verdict/route'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const DAY = '2026-09-26'

/** Brisbane is UTC+10 and has no DST, so 13:00Z is 23:00 the same evening. */
function ordinaryNights(n: number, endBefore = DAY) {
  return Array.from({ length: n }, (_, i) => {
    const date = shiftDateStr(endBefore, -(i + 1))
    return {
      date,
      sleepStart: `${shiftDateStr(date, -1)}T13:0${i % 4}:00Z`, // ~23:00–23:03 local
      durationHours: 7.5 + (i % 4) * 0.25,
      efficiency: 88 + (i % 4),
    }
  })
}
const targetNight = (over: Row = {}) => ({
  date: DAY, sleepStart: `${shiftDateStr(DAY, -1)}T13:00:00Z`,
  durationHours: 7.8, efficiency: 89, ...over,
})

const get = (qs = `?date=${DAY}`) => GET(new Request(`http://localhost/api/sleep-verdict${qs}`))
const post = (body: unknown) => POST(new Request('http://localhost/api/sleep-verdict', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

let seq = 0
beforeEach(() => {
  vi.clearAllMocks()
  getSleepVerdict.mockResolvedValue(null)
  setSleepVerdictResponse.mockResolvedValue(true)
  listSleepSessions.mockResolvedValue([])
  // A fresh user per case — the route is rate-limited and cases would throttle each other.
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' }
})

describe('GET /api/sleep-verdict', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await get()).status).toBe(401)
  })

  it('rejects a malformed date before reading anything', async () => {
    expect((await get('?date=not-a-date')).status).toBe(400)
    expect(listSleepSessions).not.toHaveBeenCalled()
  })

  it('returns a STORED verdict without recomputing it', async () => {
    const stored = { date: DAY, verdict: 'poor', responseState: 'corrected' }
    getSleepVerdict.mockResolvedValue(stored)

    const body = await (await get()).json()

    expect(body.verdict).toEqual(stored)
    // The snapshot is the point: no re-read of the nights, no re-write of the row.
    expect(listSleepSessions).not.toHaveBeenCalled()
    expect(upsertSleepVerdict).not.toHaveBeenCalled()
  })

  it('computes and persists on the first read, with the bands beside the values', async () => {
    listSleepSessions.mockResolvedValue([...ordinaryNights(28), targetNight({ durationHours: 5.2 })])

    const body = await (await get()).json()

    expect(body.verdict.verdict).toBe('poor')
    expect(body.verdict.triggered).toEqual(['duration'])
    expect(body.verdict.responseState).toBe('none')
    expect(upsertSleepVerdict).toHaveBeenCalledTimes(1)
    const [, record] = upsertSleepVerdict.mock.calls[0] as [string, Row]
    const bands = record.bands as Record<string, number | null>
    expect(record.components).toEqual({ durationHours: 5.2, onsetMinutes: -60, efficiency: 89 })
    expect(bands.durationLow).toBeGreaterThan(5.2)
    expect(record).not.toHaveProperty('responseState')  // the upsert must never set it
  })

  it('says nothing, and stores nothing, when the night has no sleep session yet', async () => {
    listSleepSessions.mockResolvedValue(ordinaryNights(28))   // history only, no target

    const body = await (await get()).json()

    expect(body.verdict).toBeNull()
    // Storing here would freeze a verdict against data the ring had not yet delivered.
    expect(upsertSleepVerdict).not.toHaveBeenCalled()
  })

  it('says nothing, and stores nothing, below the coverage floor', async () => {
    listSleepSessions.mockResolvedValue([...ordinaryNights(5), targetNight()])

    const res = await get()
    const body = await res.json()

    expect(res.status).toBe(200)          // not an error — there is simply nothing to announce
    expect(body.verdict).toBeNull()
    expect(upsertSleepVerdict).not.toHaveBeenCalled()
    // Says WHY it is silent, so the surface can tell "not enough history yet" from "nothing
    // strange about last night" — two very different things to render, and part of the contract
    // TN-82 reads.
    expect(body.baselineNightsRequired).toBe(28)
  })

  it('reads a slash date, which is the shape localDateString() emits', async () => {
    getSleepVerdict.mockResolvedValue({ date: DAY, verdict: 'normal' })
    expect((await get('?date=2026/09/26')).status).toBe(200)
    expect(getSleepVerdict).toHaveBeenCalledWith(expect.any(String), DAY)
  })

  it('never writes an answer on the lifter\'s behalf (TN-57)', async () => {
    listSleepSessions.mockResolvedValue([...ordinaryNights(28), targetNight({ durationHours: 5.2 })])
    await get()
    expect(saveDayCheckin).not.toHaveBeenCalled()
    expect(setSleepVerdictResponse).not.toHaveBeenCalled()
  })
})

describe('POST /api/sleep-verdict', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await post({ date: DAY, state: 'corrected' })).status).toBe(401)
  })

  it('records the answer against the announced day', async () => {
    const res = await post({ date: DAY, state: 'corrected' })
    expect(res.status).toBe(200)
    expect(setSleepVerdictResponse).toHaveBeenCalledWith(expect.any(String), DAY, 'corrected')
  })

  it('404s when nothing was announced for that day', async () => {
    setSleepVerdictResponse.mockResolvedValue(false)
    // A response stored against no verdict is a label with nothing beside it.
    expect((await post({ date: DAY, state: 'acknowledged' })).status).toBe(404)
  })

  it('rejects a state the design does not have', async () => {
    expect((await post({ date: DAY, state: 'agreed' })).status).toBe(400)
    expect(setSleepVerdictResponse).not.toHaveBeenCalled()
  })

  it('rejects an unknown key rather than silently dropping it (LA-128)', async () => {
    expect((await post({ date: DAY, state: 'corrected', value: 3 })).status).toBe(400)
    expect(setSleepVerdictResponse).not.toHaveBeenCalled()
  })

  it('accepts a slash date', async () => {
    expect((await post({ date: '2026/09/26', state: 'corrected' })).status).toBe(200)
    expect(setSleepVerdictResponse).toHaveBeenCalledWith(expect.any(String), DAY, 'corrected')
  })

  it('never writes a touched flag — an announcement is not his answer (TN-57)', async () => {
    await post({ date: DAY, state: 'corrected' })
    expect(saveDayCheckin).not.toHaveBeenCalled()
    expect(upsertSleepVerdict).not.toHaveBeenCalled()
  })
})
