/**
 * #2105 — the route a sheet asks "is today's readiness unusual?", and where the answer is recorded.
 *
 * Two cases matter most. **A stored verdict is returned, never recomputed** — the snapshot exists
 * so a rating stays paired with the number it answered. And **this route never writes readiness**:
 * it reads the scores `/api/readiness-score` stored and judges them, which is what keeps it from
 * being a scoring change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getReadinessVerdict = vi.fn(async (_u: string, _d: string) => null as Row | null)
const upsertReadinessVerdict = vi.fn(async (_u: string, _r: Row) => undefined)
const setReadinessVerdictResponse = vi.fn(async (_u: string, _d: string, _s: string) => true)
const getOuraDailyDerived = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const upsertOuraDailyDerived = vi.fn(async (..._a: unknown[]) => undefined)
const saveDayCheckin = vi.fn(async (..._a: unknown[]) => ({}) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getReadinessVerdict, upsertReadinessVerdict, setReadinessVerdictResponse,
    getOuraDailyDerived, upsertOuraDailyDerived, saveDayCheckin,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { GET, POST } from '@/app/api/readiness-verdict/route'

const DAY = '2026-10-06'
const V6 = 'v6:dev-warmup:2026-10-06'
const V5 = 'v5:no-checkin:2026-10-06'
const CONTRIBUTORS = {
  hrvBalance: { score: 41, provisional: false, input: -0.9, gap: null },
  restingHeartRate: { score: 55, provisional: false, input: -0.1, gap: null },
}

/** Ordinary stored days before DAY, scores 60–66 (four each over 28), stamped v5. */
function storedDays(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    day: shiftDateStr(DAY, -(i + 1)),
    readinessScore: 60 + (i % 7),
    readinessContributors: CONTRIBUTORS,
    modelVersions: { readiness: V5, bodyBattery: 'bb' },
  }))
}
const today = (over: Row = {}): Row => ({
  day: DAY, readinessScore: 63, readinessContributors: CONTRIBUTORS, modelVersions: { readiness: V6 }, ...over,
})

const get = (qs = `?date=${DAY}`) => GET(new Request(`http://localhost/api/readiness-verdict${qs}`))
const post = (body: unknown) => POST(new Request('http://localhost/api/readiness-verdict', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))

let seq = 0
beforeEach(() => {
  vi.clearAllMocks()
  getReadinessVerdict.mockResolvedValue(null)
  setReadinessVerdictResponse.mockResolvedValue(true)
  getOuraDailyDerived.mockResolvedValue([])
  // A fresh user per case — the route is rate-limited and cases would throttle each other.
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' }
})

describe('GET /api/readiness-verdict', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await get()).status).toBe(401)
  })

  it('rejects a malformed or impossible date before reading anything', async () => {
    expect((await get('?date=not-a-date')).status).toBe(400)
    expect((await get('?date=2026-13-45')).status).toBe(400)
    expect(getReadinessVerdict).not.toHaveBeenCalled()
    expect(getOuraDailyDerived).not.toHaveBeenCalled()
  })

  it('returns a STORED verdict without recomputing it', async () => {
    const stored = { date: DAY, verdict: 'poor', score: 41, responseState: 'rated' }
    getReadinessVerdict.mockResolvedValue(stored)

    const res = await get()
    const body = await res.json()

    expect(body.verdict).toEqual(stored)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    // The snapshot is the point: no re-read of the scores, no re-write of the row.
    expect(getOuraDailyDerived).not.toHaveBeenCalled()
    expect(upsertReadinessVerdict).not.toHaveBeenCalled()
  })

  it('judges the stored score on first read and freezes the evidence beside it', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: 41 })])

    const res = await get()
    const body = await res.json()

    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(body.verdict.verdict).toBe('poor')
    expect(body.verdict.responseState).toBe('none')
    expect(upsertReadinessVerdict).toHaveBeenCalledTimes(1)
    const [, record] = upsertReadinessVerdict.mock.calls[0] as [string, Row]
    expect(record).toEqual({
      date: DAY,
      verdict: 'poor',
      score: 41,
      band: { median: 63, low: 58.4, high: 67.6 },
      baselineDays: 28,
      // Today is v6 and every day before it v5 — the mix #2105 warned about, counted.
      baselineSameVersionDays: 0,
      contributors: CONTRIBUTORS,
      readinessModelVersion: V6,
      modelVersion: 2,
    })
    expect(record).not.toHaveProperty('responseState')  // the upsert must never set it
  })

  it('reads 120 days of stored scores ending on the day judged', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today()])
    await get()
    expect(getOuraDailyDerived).toHaveBeenCalledWith(expect.any(String), shiftDateStr(DAY, -120), DAY)
  })

  it('calls an ordinary score normal and a high one good', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today()])
    expect((await (await get()).json()).verdict.verdict).toBe('normal')

    sessionUser = { id: `u-${++seq}` }
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: 88 })])
    expect((await (await get()).json()).verdict.verdict).toBe('good')
  })

  it('NEVER writes readiness — it judges stored scores and moves none of them', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: 41 })])
    await get()
    expect(upsertOuraDailyDerived).not.toHaveBeenCalled()
  })

  it('says nothing, and stores nothing, when the day has no stored score yet', async () => {
    getOuraDailyDerived.mockResolvedValue(storedDays(28))   // history only
    expect((await (await get()).json()).verdict).toBeNull()

    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: null })])
    expect((await (await get()).json()).verdict).toBeNull()

    // Storing here would freeze a verdict against a score nobody had computed or seen.
    expect(upsertReadinessVerdict).not.toHaveBeenCalled()
  })

  it('says nothing, and stores nothing, when the row cannot say what produced the score', async () => {
    for (const over of [
      { readinessContributors: null },
      { readinessContributors: [1, 2] },
      { modelVersions: null },
      { modelVersions: { bodyBattery: 'bb' } },
    ]) {
      sessionUser = { id: `u-${++seq}` }
      getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: 41, ...over })])
      expect((await (await get()).json()).verdict).toBeNull()
    }
    expect(upsertReadinessVerdict).not.toHaveBeenCalled()
  })

  it('says nothing, and stores nothing, below the coverage floor — and says which silence', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(27), today({ readinessScore: 10 })])

    const res = await get()
    const body = await res.json()

    expect(res.status).toBe(200)          // not an error — there is simply nothing to say yet
    expect(body.verdict).toBeNull()
    expect(body.baselineDaysRequired).toBe(28)
    expect(upsertReadinessVerdict).not.toHaveBeenCalled()
  })

  it('reads a slash date, which is the shape localDateString() emits', async () => {
    getReadinessVerdict.mockResolvedValue({ date: DAY, verdict: 'normal' })
    expect((await get('?date=2026/10/06')).status).toBe(200)
    expect(getReadinessVerdict).toHaveBeenCalledWith(expect.any(String), DAY)
  })

  it('defaults to today in the user\'s timezone', async () => {
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    await get('')
    expect(getReadinessVerdict).toHaveBeenCalledWith(expect.any(String), todayInTz('Australia/Brisbane'))
  })

  it('never records an answer on his behalf', async () => {
    getOuraDailyDerived.mockResolvedValue([...storedDays(28), today({ readinessScore: 41 })])
    await get()
    expect(setReadinessVerdictResponse).not.toHaveBeenCalled()
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })

  it('answers a failed read with a 500 that carries no raw error', async () => {
    getReadinessVerdict.mockRejectedValue(new Error('connection terminated: secret detail'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})

describe('POST /api/readiness-verdict', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await post({ date: DAY, state: 'rated' })).status).toBe(401)
  })

  it('records a rating, or a dismissal, against the judged day', async () => {
    expect((await post({ date: DAY, state: 'rated' })).status).toBe(200)
    expect(setReadinessVerdictResponse).toHaveBeenLastCalledWith(expect.any(String), DAY, 'rated')
    expect((await post({ date: DAY, state: 'dismissed' })).status).toBe(200)
    expect(setReadinessVerdictResponse).toHaveBeenLastCalledWith(expect.any(String), DAY, 'dismissed')
  })

  it('404s when nothing was judged for that day', async () => {
    setReadinessVerdictResponse.mockResolvedValue(false)
    // A response stored against no verdict is a label with nothing beside it.
    expect((await post({ date: DAY, state: 'rated' })).status).toBe(404)
  })

  it('rejects a state the design does not have — including sleep\'s', async () => {
    expect((await post({ date: DAY, state: 'acknowledged' })).status).toBe(400)
    expect((await post({ date: DAY, state: 'none' })).status).toBe(400)
    expect(setReadinessVerdictResponse).not.toHaveBeenCalled()
  })

  it('rejects an unknown key rather than silently dropping it', async () => {
    expect((await post({ date: DAY, state: 'rated', value: 3 })).status).toBe(400)
    expect(setReadinessVerdictResponse).not.toHaveBeenCalled()
  })

  it('accepts a slash date', async () => {
    expect((await post({ date: '2026/10/06', state: 'dismissed' })).status).toBe(200)
    expect(setReadinessVerdictResponse).toHaveBeenCalledWith(expect.any(String), DAY, 'dismissed')
  })

  it('writes the response state and nothing else', async () => {
    await post({ date: DAY, state: 'rated' })
    expect(upsertReadinessVerdict).not.toHaveBeenCalled()
    expect(upsertOuraDailyDerived).not.toHaveBeenCalled()
    expect(saveDayCheckin).not.toHaveBeenCalled()
  })
})
