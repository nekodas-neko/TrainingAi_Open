/**
 * PS-39's last two: `admin/battery-recovery-calibration` and `workout/backfill-set-hr-stats`.
 * (`oura/hr-sync` was the third, and was deleted as dead in LA-89 — `complete-workout` runs the
 * same attribution in-process.)
 *
 * What each decides:
 *
 *   · **The set-HR backfill persists a zero-reading row on purpose**, stamping `computed_at` even
 *     when nothing had landed; the lister is coverage-aware and re-lists it, so a later fuller
 *     compute still wins.
 *   · **The battery calibration reads persisted values and does NOT recompute them** — so, unlike
 *     its sleep-feel sibling, it fetches no lead-in window. The panel checks what the app actually
 *     served, not what a fresh run would produce.
 *
 * Not exercised: the calibration builder, the HR computation and the attribution pipeline are all
 * stand-ins. No SQL, no ring, no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isActive: true, isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

const getBodyBatteryHistory = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listDayCheckins = vi.fn(async (..._a: unknown[]) => [] as Row[])
const buildBatteryRecoveryCalibration = vi.fn((_i: Row) => ({ from: 'x', to: 'y', rows: [] }))

const listSessionsMissingSetHrStats = vi.fn(async (..._a: unknown[]) => [] as Row[])
const upsertSetHrStats = vi.fn(async (..._a: unknown[]) => undefined)
const computeWorkoutHr = vi.fn(async (..._a: unknown[]) => null as Row | null)

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getBodyBatteryHistory: (...a: unknown[]) => getBodyBatteryHistory(...a),
    listDayCheckins: (...a: unknown[]) => listDayCheckins(...a),
    listSessionsMissingSetHrStats: (...a: unknown[]) => listSessionsMissingSetHrStats(...a),
    upsertSetHrStats: (...a: unknown[]) => upsertSetHrStats(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/health/battery-recovery-calibration', () => ({
  buildBatteryRecoveryCalibration: (i: Row) => buildBatteryRecoveryCalibration(i),
}))
vi.mock('@trainingai/shared/workout/compute-workout-hr', () => ({
  computeWorkoutHr: (...a: unknown[]) => computeWorkoutHr(...a),
}))

import { GET as batteryGet } from '@/app/api/admin/battery-recovery-calibration/route'
import { POST as setBackfillPost } from '@/app/api/workout/backfill-set-hr-stats/route'

const batteryReq = async (qs = '') => {
  const { NextRequest } = await import('next/server')
  return batteryGet(new NextRequest(`http://localhost/api/admin/battery-recovery-calibration${qs}`))
}

const setBackfillReq = (body?: unknown) =>
  setBackfillPost(new Request('http://localhost/api/workout/backfill-set-hr-stats', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  for (const m of [getUserById, rateLimit, reportServerError, getBodyBatteryHistory, listDayCheckins,
                   buildBatteryRecoveryCalibration,
                   listSessionsMissingSetHrStats, upsertSetHrStats, computeWorkoutHr]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isActive: true, isAdmin: true })
  getBodyBatteryHistory.mockResolvedValue([])
  listDayCheckins.mockResolvedValue([])
  buildBatteryRecoveryCalibration.mockReturnValue({ from: 'x', to: 'y', rows: [] })
  listSessionsMissingSetHrStats.mockResolvedValue([])
  computeWorkoutHr.mockResolvedValue(null)
  sessionUser = { id: 'u-1', isAdmin: true }
})

afterEach(() => { vi.useRealTimers() })

describe('the admin gate', () => {
  const ADMIN_ONLY: [string, () => Promise<Response>][] = [
    ['battery calibration', () => batteryReq()],
    ['set-HR backfill', () => setBackfillReq()],
  ]

  it('refuses a non-admin on the two admin routes, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isActive: true, isAdmin: false })
    for (const [name, call] of ADMIN_ONLY) expect((await call()).status, name).toBe(403)
    expect(upsertSetHrStats).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ADMIN_ONLY) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 401 with no session on both', async () => {
    sessionUser = null
    for (const [name, call] of ADMIN_ONLY) expect((await call()).status, name).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('POST /api/workout/backfill-set-hr-stats', () => {
  const sessions = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `ws-${i}`, startedAt: new Date('2026-09-01T10:00:00Z'), completedAt: new Date('2026-09-01T11:00:00Z'),
  }))

  it('defaults to 100 rows over the 180-day retention window', async () => {
    // 100, not the HR-stats backfill's 200 — per-set rows are heavier. Derived from a pinned clock
    // rather than a hardcoded date, because one fixed side of a rolling window is a time bomb.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    await setBackfillReq()
    const [userId, since, limit] = listSessionsMissingSetHrStats.mock.calls[0] as [string, Date, number]
    expect(userId).toBe('u-1')
    expect(limit).toBe(100)
    expect(Math.round((Date.now() - since.getTime()) / 86_400_000)).toBe(180)
  })

  it('takes maxRows from the body, rounded and clamped to 1000', async () => {
    await setBackfillReq({ maxRows: 25 })
    expect((listSessionsMissingSetHrStats.mock.calls[0] as unknown[])[2]).toBe(25)
    listSessionsMissingSetHrStats.mockClear()
    await setBackfillReq({ maxRows: 9_999 })
    expect((listSessionsMissingSetHrStats.mock.calls[0] as unknown[])[2]).toBe(1000)
    listSessionsMissingSetHrStats.mockClear()
    await setBackfillReq({ maxRows: 10.6 })
    expect((listSessionsMissingSetHrStats.mock.calls[0] as unknown[])[2]).toBe(11)
  })

  it('ignores a maxRows it cannot use and an unreadable body, keeping the default', async () => {
    for (const maxRows of ['25', 0, -5, null] as unknown[]) {
      listSessionsMissingSetHrStats.mockClear()
      await setBackfillReq({ maxRows })
      expect((listSessionsMissingSetHrStats.mock.calls[0] as unknown[])[2], String(maxRows)).toBe(100)
    }
    listSessionsMissingSetHrStats.mockClear()
    await setBackfillPost(new Request('http://localhost/api/workout/backfill-set-hr-stats', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
    }))
    expect((listSessionsMissingSetHrStats.mock.calls[0] as unknown[])[2]).toBe(100)
  })

  it('refuses an oversized body', async () => {
    expect((await setBackfillReq({ maxRows: 5, note: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(listSessionsMissingSetHrStats).not.toHaveBeenCalled()
  })

  it('counts withData from ANY set having readings, not from the session being processed', async () => {
    // `processed` and `withData` must differ, or neither is under test. The middle session has all
    // its sets at zero readings — persisted on purpose to stamp `computed_at`, and not counted as
    // data. The third has one set with readings among several without, which is the realistic case:
    // a strap that dropped out mid-session.
    listSessionsMissingSetHrStats.mockResolvedValue(sessions(3))
    computeWorkoutHr
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ setHrRows: [{ readingsCount: 0 }, { readingsCount: 0 }] })
      .mockResolvedValueOnce({ setHrRows: [{ readingsCount: 0 }, { readingsCount: 42 }] })
    const body = await (await setBackfillReq()).json()
    expect(body.processed).toBe(2)
    expect(body.withData).toBe(1)
    expect(upsertSetHrStats).toHaveBeenCalledTimes(2)
    expect(upsertSetHrStats).toHaveBeenNthCalledWith(1, 'u-1', 'ws-1', [{ readingsCount: 0 }, { readingsCount: 0 }])
  })

  it('reports remaining from the BATCH being full, not from what it processed', async () => {
    // Reading it off `processed` would say "drained" whenever a batch contained skipped sessions —
    // exactly when it is not.
    listSessionsMissingSetHrStats.mockResolvedValue(sessions(4))
    computeWorkoutHr.mockResolvedValue(null)
    expect(await (await setBackfillReq({ maxRows: 4 })).json()).toMatchObject({
      processed: 0, withData: 0, remaining: true,
    })
    listSessionsMissingSetHrStats.mockResolvedValue(sessions(3))
    expect((await (await setBackfillReq({ maxRows: 4 })).json()).remaining).toBe(false)
  })

  it('passes the caller’s timezone into the HR computation', async () => {
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    listSessionsMissingSetHrStats.mockResolvedValue(sessions(1))
    await setBackfillReq()
    expect((computeWorkoutHr.mock.calls[0] as unknown[])[3]).toBe('Europe/Berlin')
  })

  it('rate-limits at its own low allowance', async () => {
    rateLimit.mockReturnValue(false)
    expect((await setBackfillReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([6, 60_000])
    expect(listSessionsMissingSetHrStats).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/battery-recovery-calibration', () => {
  it('fetches BOTH sides for the requested window, with no lead-in', async () => {
    // The difference from its sleep-feel sibling, which fetches 28 days more sleep than it reports
    // on. Nothing is recomputed here — `end_value` is read as persisted, so the panel checks what
    // the app actually served rather than what a fresh run would produce, and a lead-in would be
    // fetching rows it has no use for.
    await batteryReq('?from=2026-03-01&to=2026-03-10')
    expect((getBodyBatteryHistory.mock.calls[0] as unknown[]).slice(1)).toEqual(['2026-03-01', '2026-03-10'])
    expect((listDayCheckins.mock.calls[0] as unknown[]).slice(1)).toEqual(['2026-03-01', '2026-03-10', 'morning'])
  })

  it('lets an explicit from/to win over days', async () => {
    await batteryReq('?from=2026-03-01&to=2026-03-10&days=90')
    expect(buildBatteryRecoveryCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-01', to: '2026-03-10' })
  })

  it('derives the start from days, inclusive of both ends, and clamps to 180', async () => {
    await batteryReq('?to=2026-03-10&days=3')
    expect(buildBatteryRecoveryCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-08', to: '2026-03-10' })
    buildBatteryRecoveryCalibration.mockClear()
    await batteryReq('?to=2026-12-31&days=999')
    expect(buildBatteryRecoveryCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-07-05' })
  })

  it('falls back to the 60-day default for a days it cannot use', async () => {
    for (const qs of ['?to=2026-03-10', '?to=2026-03-10&days=0', '?to=2026-03-10&days=nonsense']) {
      buildBatteryRecoveryCalibration.mockClear()
      await batteryReq(qs)
      expect(buildBatteryRecoveryCalibration.mock.calls[0][0], qs).toMatchObject({ from: '2026-01-10' })
    }
  })

  it('accepts either date separator and refuses anything else', async () => {
    await batteryReq('?from=2026/03/01&to=2026/03/10')
    expect(buildBatteryRecoveryCalibration.mock.calls[0][0]).toMatchObject({ from: '2026-03-01', to: '2026-03-10' })
    for (const qs of ['?from=01-03-2026', '?to=nonsense']) {
      const res = await batteryReq(qs)
      expect(res.status, qs).toBe(400)
      expect((await res.json()).error, qs).toContain('Invalid date')
    }
  })

  it('refuses a reversed range and one wider than 180 days, with different messages', async () => {
    const reversed = await batteryReq('?from=2026-03-10&to=2026-03-01')
    expect(reversed.status).toBe(400)
    expect((await reversed.json()).error).toContain('must not precede')

    const tooWide = await batteryReq('?from=2026-01-01&to=2026-12-31')
    expect(tooWide.status).toBe(400)
    expect((await tooWide.json()).error).toContain('365 days requested')
    expect(getBodyBatteryHistory).not.toHaveBeenCalled()
  })

  it('keys battery by its date and recovery by the check-in’s log date', async () => {
    getBodyBatteryHistory.mockResolvedValue([{ date: '2026-03-02', endValue: 61 }])
    // `perceivedRecoveryTouched` is what makes the 4 an answer (TN-57): the morning sheet seeds
    // this scale from a neutral constant, and 78 of the owner's 97 rows carry a value he never
    // chose. The subject here is the date keying, so the flag is set to keep it that.
    listDayCheckins.mockResolvedValue([
      { logDate: '2026-03-02', perceivedRecovery: 4, perceivedRecoveryTouched: true },
      { logDate: '2026-03-03', perceivedRecovery: null, perceivedRecoveryTouched: true },
    ])
    await batteryReq('?from=2026-03-01&to=2026-03-10')
    const input = buildBatteryRecoveryCalibration.mock.calls[0][0] as {
      batteryByDate: Map<string, unknown>; recoveryByDate: Map<string, unknown>
    }
    expect(input.batteryByDate.get('2026-03-02')).toBe(61)
    expect(input.recoveryByDate.get('2026-03-02')).toBe(4)
    expect(input.recoveryByDate.get('2026-03-03')).toBeNull()
  })

  it('does not carry an untouched recovery through at all (TN-57)', async () => {
    getBodyBatteryHistory.mockResolvedValue([{ date: '2026-03-02', endValue: 61 }])
    listDayCheckins.mockResolvedValue([{ logDate: '2026-03-02', perceivedRecovery: 4, perceivedRecoveryTouched: false }])
    await batteryReq('?from=2026-03-01&to=2026-03-10')
    const input = buildBatteryRecoveryCalibration.mock.calls[0][0] as { recoveryByDate: Map<string, unknown> }
    expect(input.recoveryByDate.has('2026-03-02')).toBe(true)
    expect(input.recoveryByDate.get('2026-03-02')).toBeNull()
  })

  it('reports the caller’s timezone back, and uses it for the window', async () => {
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    const body = await (await batteryReq('?from=2026-03-01&to=2026-03-10')).json()
    expect(body.timezone).toBe('Europe/Berlin')
  })

  it('files a failure as a fault and answers 500, but does NOT file a refused range', async () => {
    // A refused request is the caller's mistake; filing it into `error_events` buries the real
    // faults in the table every session reads at start-up.
    getBodyBatteryHistory.mockRejectedValue(new Error('statement timeout'))
    const res = await batteryReq('?from=2026-03-01&to=2026-03-10')
    expect(res.status).toBe(500)
    expect((await res.json()).detail).toContain('statement timeout')
    expect(reportServerError).toHaveBeenCalledWith(expect.any(Error), {
      userId: 'u-1', url: '/api/admin/battery-recovery-calibration',
    })

    reportServerError.mockClear()
    await batteryReq('?from=2026-01-01&to=2026-12-31')
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('rate-limits before reading, and sends no-store', async () => {
    expect((await batteryReq()).headers.get('Cache-Control')).toBe('private, no-store')
    rateLimit.mockReturnValue(false)
    expect((await batteryReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([20, 60_000])
  })
})
