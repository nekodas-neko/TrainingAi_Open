/**
 * PS-39 — three admin reports: `admin/app-load-report`, `admin/timing-baseline` and
 * `admin/sleep-feel-calibration`. They share the admin gate and each parses its window a different
 * way, which is the whole of what a route-level test can hold them to.
 *
 * What each decides:
 *
 *   · **`app-load-report` splits cold from warm and reports both totals.** The split is the report,
 *     not a facet of it: every merge is a deploy, the service worker's cache name is stamped from
 *     the deploy SHA, and a pooled percentile measures release cadence rather than the app. The two
 *     sample counts are stated so a reader seeing only warm rows knows which it means.
 *   · **`timing-baseline` accepts a NULL date**, because clearing the baseline is the operation you
 *     reach for when the stored one is wrong — a schema that only took a string would make the
 *     clear button unimplementable.
 *   · **`sleep-feel-calibration` fetches 28 days MORE sleep than it reports on.** The earliest night
 *     in the window has to be scored against real baselines; without the lead-in its first nights
 *     lose the HRV/HR/schedule contributors and the model's spread reads narrower than it is. The
 *     two repository calls therefore take *different* ranges, and that is the assertion.
 *
 * Not exercised: the scorer, the night-assembly and the calibration builder are all mocked, so this
 * says nothing about whether a score is right — only which window each is asked for. No SQL runs.
 * Web/Node only: no device, no native surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const getAppLoadReport = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getTimingBaselineDate = vi.fn(async (_u: string) => '2026-01-15' as string | null)
const setTimingBaselineDate = vi.fn(async (..._a: unknown[]) => undefined)
const listSleepSessions = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listDayCheckins = vi.fn(async (..._a: unknown[]) => [] as Row[])
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

const nightSessions = vi.fn((rows: Row[], _tz: string) => rows)
const computeSleepScoreSeries = vi.fn((nights: Row[], _tz: string) =>
  nights.map(n => ({ session: n, result: { score: 80 } as { score: number } | null })))
const buildSleepFeelCalibration = vi.fn((_input: Row) => ({ from: 'x', to: 'y', rows: [], notes: [] }))

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getAppLoadReport: (...a: unknown[]) => getAppLoadReport(...a),
    getTimingBaselineDate: (...a: unknown[]) => getTimingBaselineDate(...(a as [string])),
    setTimingBaselineDate: (...a: unknown[]) => setTimingBaselineDate(...a),
    listSleepSessions: (...a: unknown[]) => listSleepSessions(...a),
    listDayCheckins: (...a: unknown[]) => listDayCheckins(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
// The three health helpers are stand-ins: the route's job is to decide WHICH nights and WHICH
// window, and leaving the real scorer in would make every assertion here depend on it.
vi.mock('@trainingai/shared/health/sleep-night', () => ({
  nightSessions: (r: Row[], tz: string) => nightSessions(r, tz),
}))
vi.mock('@trainingai/shared/health/sleep-score', () => ({
  computeSleepScoreSeries: (n: Row[], tz: string) => computeSleepScoreSeries(n, tz),
}))
vi.mock('@trainingai/shared/health/sleep-feel-calibration', () => ({
  buildSleepFeelCalibration: (i: Row) => buildSleepFeelCalibration(i),
}))

import { GET as appLoadGet } from '@/app/api/admin/app-load-report/route'
import { GET as timingGet, POST as timingPost } from '@/app/api/admin/timing-baseline/route'
import { GET as calibrationGet } from '@/app/api/admin/sleep-feel-calibration/route'

const appLoadReq = (qs = '') =>
  appLoadGet(new Request(`http://localhost/api/admin/app-load-report${qs}`))

const timingReq = (body: unknown) =>
  timingPost(new Request('http://localhost/api/admin/timing-baseline', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

/** `NextRequest` is needed for `req.nextUrl`, which the calibration route reads. */
const calibrationReq = async (qs = '') => {
  const { NextRequest } = await import('next/server')
  return calibrationGet(new NextRequest(`http://localhost/api/admin/sleep-feel-calibration${qs}`))
}

beforeEach(() => {
  for (const m of [getUserById, rateLimit, getAppLoadReport, getTimingBaselineDate, setTimingBaselineDate,
                   listSleepSessions, listDayCheckins, reportServerError, nightSessions,
                   computeSleepScoreSeries, buildSleepFeelCalibration]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getAppLoadReport.mockResolvedValue([])
  getTimingBaselineDate.mockResolvedValue('2026-01-15')
  listSleepSessions.mockResolvedValue([])
  listDayCheckins.mockResolvedValue([])
  nightSessions.mockImplementation((r: Row[]) => r)
  buildSleepFeelCalibration.mockReturnValue({ from: 'x', to: 'y', rows: [], notes: [] })
  sessionUser = { id: 'u-1', isAdmin: true }
})

describe('the admin gate on all three reports', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['app-load GET', () => appLoadReq()],
    ['timing GET', () => timingGet()],
    ['timing POST', () => timingReq({ date: '2026-02-01' })],
    ['calibration GET', () => calibrationReq()],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    // The claim is stamped at login and can be 30 days stale; `requireAdmin` reads the database. A
    // fixture agreeing with itself could not tell which one the route consulted.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(setTimingBaselineDate).not.toHaveBeenCalled()
    expect(getAppLoadReport).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('admits an admin whose token claims nothing at all', async () => {
    // The opposite direction, and it is load-bearing: without it a route that always answered 403
    // would pass the stale-claim case above.
    sessionUser = { id: 'u-1' }
    getUserById.mockResolvedValue({ isAdmin: true })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(200)
  })

  it('answers 401 with no session, before touching the repository', async () => {
    sessionUser = null
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(401)
      expect(await res.json(), name).toEqual({ error: 'Unauthorized' })
    }
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/app-load-report', () => {
  it('defaults to 7 days, and reports the window it actually used', async () => {
    await appLoadReq()
    expect(getAppLoadReport).toHaveBeenLastCalledWith('u-1', 7)
    expect((await (await appLoadReq('?days=14')).json()).days).toBe(14)
    expect(getAppLoadReport).toHaveBeenLastCalledWith('u-1', 14)
  })

  it('REFUSES a window wider than retention rather than clamping it', async () => {
    // `.max(14)` rejects; it does not silently narrow. That is the better half of the choice — a
    // clamp would answer 200 with `days: 14` to someone who asked for 30 and believes they are
    // reading a month. 14 is the retention window, so there is no wider answer to give.
    const res = await appLoadReq('?days=30')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid query' })
    expect(getAppLoadReport).not.toHaveBeenCalled()
  })

  it('refuses a non-numeric, zero or fractional days', async () => {
    // Each of these is a different schema rule — coercion, `.min(1)`, `.int()` — and defaulting
    // instead would answer 200 with a window the caller did not ask for, which is the same shape
    // as a correct response and so the worst way to be wrong.
    for (const qs of ['?days=nonsense', '?days=0', '?days=2.5', '?days=']) {
      expect((await appLoadReq(qs)).status, qs).toBe(400)
    }
    expect(getAppLoadReport).not.toHaveBeenCalled()
  })

  it('IGNORES an unknown query param despite the schema being strict — pinned, not endorsed', async () => {
    // `.strict()` cannot fire here: the route hands the schema an object it built itself, holding
    // only `days`, so an unknown param is dropped before validation ever sees it. The `.strict()`
    // on this schema therefore guards nothing. Harmless as it stands — but a reader adding a second
    // param will assume the typo protection is already in place, and it is not.
    const res = await appLoadReq('?unknown=1&dayz=30')
    expect(res.status).toBe(200)
    expect((await res.json()).days).toBe(7)
  })

  it('counts cold and warm samples separately, summing samples rather than rows', async () => {
    // Two cold rows carrying 3 and 4 samples: a fixture of one row each, or of rows whose sample
    // counts matched, could not tell "sum the samples" from "count the rows".
    getAppLoadReport.mockResolvedValue([
      { route: '/home', cold: true, samples: 3, p50Ms: 900, p95Ms: 1800, worstMs: 2400 },
      { route: '/nutrition', cold: true, samples: 4, p50Ms: 800, p95Ms: 1500, worstMs: 2000 },
      { route: '/home', cold: false, samples: 11, p50Ms: 120, p95Ms: 300, worstMs: 900 },
    ])
    const body = await (await appLoadReq()).json()
    expect(body.coldSamples).toBe(7)
    expect(body.warmSamples).toBe(11)
    expect(body.routes).toHaveLength(3)
  })

  it('reports zero for a side with no rows rather than omitting it', async () => {
    // "No cold samples recorded" and "the app is never cold" are different findings, and an absent
    // key reads as the second.
    getAppLoadReport.mockResolvedValue([
      { route: '/home', cold: false, samples: 5, p50Ms: 120, p95Ms: 300, worstMs: 900 },
    ])
    const body = await (await appLoadReq()).json()
    expect(body.coldSamples).toBe(0)
    expect(body.warmSamples).toBe(5)
  })

  it('sends no-store, so nothing sits between the reader and the numbers', async () => {
    expect((await appLoadReq()).headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('rate-limits before reading', async () => {
    rateLimit.mockReturnValue(false)
    expect((await appLoadReq()).status).toBe(429)
    expect(getAppLoadReport).not.toHaveBeenCalled()
  })
})

describe('/api/admin/timing-baseline', () => {
  it('returns the stored date', async () => {
    expect(await (await timingGet()).json()).toEqual({ date: '2026-01-15' })
    expect(getTimingBaselineDate).toHaveBeenCalledWith('u-1')
  })

  it('reports an unset baseline as null rather than omitting it', async () => {
    getTimingBaselineDate.mockResolvedValue(null)
    expect(await (await timingGet()).json()).toEqual({ date: null })
  })

  it('accepts both separators, because localDateString() emits slashes', async () => {
    // Q-130. A dash-only regex rejects every request from a client that fills the field from
    // `localDateString()`, and it fails in the validation gate before the handler runs.
    expect((await timingReq({ date: '2026-02-01' })).status).toBe(200)
    expect((await timingReq({ date: '2026/02/01' })).status).toBe(200)
    expect(setTimingBaselineDate).toHaveBeenNthCalledWith(2, 'u-1', '2026/02/01')
  })

  it('accepts an explicit null, because clearing the baseline is an operation', async () => {
    const res = await timingReq({ date: null })
    expect(await res.json()).toEqual({ date: null })
    expect(setTimingBaselineDate).toHaveBeenCalledWith('u-1', null)
  })

  it('refuses a malformed date, a missing key and an unknown one', async () => {
    // `.strict()` per Q-464: a mistyped key would otherwise be dropped and answered 200, so the
    // caller sees success and the baseline never moves.
    for (const body of [{ date: '01-02-2026' }, { date: 'today' }, {}, { date: '2026-02-01', extra: 1 }]) {
      expect((await timingReq(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(setTimingBaselineDate).not.toHaveBeenCalled()
  })

  it('distinguishes a body it cannot read from one it can read and rejects', async () => {
    const res = await timingPost(new Request('http://localhost/api/admin/timing-baseline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
    }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid body' })
    expect((await timingReq({ date: 'nope' })).status).toBe(400)
    expect(await (await timingReq({ date: 'nope' })).json()).toEqual({ error: 'Invalid date' })
  })
})

describe('GET /api/admin/sleep-feel-calibration', () => {
  const rangeOf = (fn: typeof listSleepSessions) => (fn.mock.calls[0] as unknown[]).slice(1, 3)

  it('fetches 28 days more sleep than it reports on, and no more check-ins', async () => {
    // The lead-in is the reason the two calls differ. A test asserting only that sleep was fetched
    // for the window would pass with the lead-in deleted, and the early nights would quietly lose
    // their HRV/HR/schedule contributors.
    await calibrationReq('?from=2026-03-01&to=2026-03-10')
    expect(rangeOf(listSleepSessions)).toEqual(['2026-02-01', '2026-03-10'])
    expect(rangeOf(listDayCheckins)).toEqual(['2026-03-01', '2026-03-10'])
    expect(listDayCheckins.mock.calls[0][3]).toBe('morning')
  })

  it('lets an explicit from/to win over days', async () => {
    // `days` is the admin card's shorthand. A fixture whose `days` happened to produce the same
    // window as the explicit range could not tell which one the route used, so they disagree here.
    await calibrationReq('?from=2026-03-01&to=2026-03-10&days=90')
    expect(buildSleepFeelCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-01', to: '2026-03-10' })
  })

  it('derives the start from days when only days is given, inclusive of both ends', async () => {
    await calibrationReq('?to=2026-03-10&days=3')
    expect(buildSleepFeelCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-08', to: '2026-03-10' })
  })

  it('clamps days to the 180-day maximum and floors a fractional one', async () => {
    await calibrationReq('?to=2026-12-31&days=999')
    expect(buildSleepFeelCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-07-05', to: '2026-12-31' })
    buildSleepFeelCalibration.mockClear()
    await calibrationReq('?to=2026-03-10&days=3.9')
    expect(buildSleepFeelCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-08' })
  })

  it('falls back to the 60-day default for a days it cannot use', async () => {
    for (const qs of ['?to=2026-03-10', '?to=2026-03-10&days=0', '?to=2026-03-10&days=nonsense']) {
      buildSleepFeelCalibration.mockClear()
      await calibrationReq(qs)
      expect(buildSleepFeelCalibration.mock.calls[0][0], qs).toMatchObject({ from: '2026-01-10' })
    }
  })

  it('accepts either separator and refuses anything else', async () => {
    await calibrationReq('?from=2026/03/01&to=2026/03/10')
    expect(buildSleepFeelCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-01', to: '2026-03-10' })
    for (const qs of ['?from=01-03-2026', '?to=nonsense', '?from=2026-13-45']) {
      const res = await calibrationReq(qs)
      expect(res.status, qs).toBe(400)
      expect((await res.json()).error, qs).toContain('Invalid date')
    }
  })

  it('refuses a reversed range and one wider than 180 days, with different messages', async () => {
    // Two 400s that a status-only assertion could not tell apart, and they are different mistakes:
    // one is a typo in the form, the other is a request the report will not serve.
    const reversed = await calibrationReq('?from=2026-03-10&to=2026-03-01')
    expect(reversed.status).toBe(400)
    expect((await reversed.json()).error).toContain('must not precede')

    const tooWide = await calibrationReq('?from=2026-01-01&to=2026-12-31')
    expect(tooWide.status).toBe(400)
    expect((await tooWide.json()).error).toContain('365 days requested')
    expect(listSleepSessions).not.toHaveBeenCalled()
  })

  it('passes the CALLER’s timezone to the night assembly, not the default', async () => {
    // A fixture whose timezone IS `DEFAULT_TZ` proves nothing about which one the route read.
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    const body = await (await calibrationReq('?from=2026-03-01&to=2026-03-10')).json()
    expect(nightSessions.mock.calls[0][1]).toBe('Europe/Berlin')
    expect(computeSleepScoreSeries.mock.calls[0][1]).toBe('Europe/Berlin')
    expect(body.timezone).toBe('Europe/Berlin')
  })

  it('scores the nights the assembly kept, not the raw rows', async () => {
    // Naps and fragments are dropped before scoring. With the stand-in returning its input this
    // would be invisible, so it drops one here.
    listSleepSessions.mockResolvedValue([{ date: '2026-03-01' }, { date: '2026-03-02' }])
    nightSessions.mockReturnValue([{ date: '2026-03-02' }])
    await calibrationReq('?from=2026-03-01&to=2026-03-10')
    expect(computeSleepScoreSeries.mock.calls[0][0]).toEqual([{ date: '2026-03-02' }])
    expect([...(buildSleepFeelCalibration.mock.calls[0][0] as { scoresByDate: Map<string, unknown> }).scoresByDate.keys()])
      .toEqual(['2026-03-02'])
  })

  it('keeps a night whose score could not be computed, as a null rather than a gap', async () => {
    // A night the scorer could not rate is not the same as a night with no data, and the
    // calibration's own row count depends on the difference.
    listSleepSessions.mockResolvedValue([{ date: '2026-03-02' }])
    computeSleepScoreSeries.mockReturnValue([{ session: { date: '2026-03-02' }, result: null }])
    await calibrationReq('?from=2026-03-01&to=2026-03-10')
    const scores = (buildSleepFeelCalibration.mock.calls[0][0] as { scoresByDate: Map<string, unknown> }).scoresByDate
    expect(scores.get('2026-03-02')).toBeNull()
    expect(scores.has('2026-03-02')).toBe(true)
  })

  it('carries the check-in feel through by its own log date', async () => {
    listDayCheckins.mockResolvedValue([
      { logDate: '2026-03-02', sleepQualityFeel: 4 },
      { logDate: '2026-03-03', sleepQualityFeel: null },
    ])
    await calibrationReq('?from=2026-03-01&to=2026-03-10')
    const feel = (buildSleepFeelCalibration.mock.calls[0][0] as { feelByDate: Map<string, unknown> }).feelByDate
    expect(feel.get('2026-03-02')).toBe(4)
    expect(feel.get('2026-03-03')).toBeNull()
  })

  it('reports a failure as a fault and answers 500', async () => {
    listSleepSessions.mockRejectedValue(new Error('statement timeout'))
    const res = await calibrationReq('?from=2026-03-01&to=2026-03-10')
    expect(res.status).toBe(500)
    expect((await res.json()).detail).toContain('statement timeout')
    expect(reportServerError).toHaveBeenCalledWith(expect.any(Error), {
      userId: 'u-1', url: '/api/admin/sleep-feel-calibration',
    })
  })

  it('does NOT file a rejected range as a fault', async () => {
    // A refused request is the caller's mistake, and filing it into `error_events` buries the real
    // faults in the table every session reads at start-up.
    await calibrationReq('?from=2026-01-01&to=2026-12-31')
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('rate-limits before reading', async () => {
    rateLimit.mockReturnValue(false)
    expect((await calibrationReq()).status).toBe(429)
    expect(listSleepSessions).not.toHaveBeenCalled()
  })

  it('sends no-store', async () => {
    expect((await calibrationReq()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
