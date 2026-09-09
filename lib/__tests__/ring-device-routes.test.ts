/**
 * PS-39 — the three ring-device routes: `oura-ble/rekey`, `oura-ble/device-metrics` and
 * `colmi/status`.
 *
 * **`rekey` DECLARES a re-key; it does not perform one.** The re-key itself is a deliberate act
 * done with `open_oura` on a laptop, and it is what an app uninstall destroys unrecoverably. This
 * route only records that it happened, so the ingest path stops having to guess — which matters
 * because guessing from counter shape re-timed the owner's entire sleep history twice (+12.17 h,
 * then +14.16 h). A re-key and a history re-drain look identical by shape: both drop a batch's max
 * ds below the epoch's high-water mark.
 *
 * What each decides:
 *
 *   · **The declaration is idempotent and says which case happened.** The effect is deferred until
 *     the ring next reports, so "accepted" and "already waiting" are indistinguishable from the
 *     outside unless the response says so.
 *   · **A CONSUMED declaration is deliberately not cancellable** — the epoch it opened exists and
 *     every timestamp derived from it depends on that row as the audit trail. Only a pending one
 *     can be withdrawn.
 *   · **`device-metrics` treats today as a partial day**, so completeness is measured against the
 *     bins elapsed so far rather than a full 96 — otherwise every reading of today looks like a
 *     wear failure.
 *   · **`colmi/status` is deliberately NOT admin-gated**, unlike its two neighbours here. It is a
 *     signed-in user's own ring status, and an admin gate would break it for anyone else.
 *
 * Not exercised: the curve builders and the completeness scorer are stand-ins, so this says nothing
 * about whether a curve is right — only which samples reach it. No SQL, no ring, no device.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

const getPendingRekeyDeclaration = vi.fn(async (_u: string) => null as Row | null)
const declareOuraRekey = vi.fn(async (..._a: unknown[]) => ({
  id: 'rk-1', declaredAt: new Date('2026-09-09T04:00:00Z'), alreadyPending: false,
}))
const cancelPendingRekeyDeclaration = vi.fn(async (_u: string) => true)

const getOuraRawSamplesForTags = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listSleepSessions = vi.fn(async (..._a: unknown[]) => [] as Row[])
const getColmiLatestReadingAt = vi.fn(async (_u: string) => null as Date | null)

const daytimeHrvCurve = vi.fn((s: Row[], _sleep: Row[]) => s)
const intradayTempCurve = vi.fn((s: Row[]) => s)
const intradaySpo2Curve = vi.fn((s: Row[]) => s)
const completenessForDay = vi.fn((i: Row) => ({ ...i, pct: 50 }))

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getPendingRekeyDeclaration: (u: string) => getPendingRekeyDeclaration(u),
    declareOuraRekey: (...a: unknown[]) => declareOuraRekey(...a),
    cancelPendingRekeyDeclaration: (u: string) => cancelPendingRekeyDeclaration(u),
    getOuraRawSamplesForTags: (...a: unknown[]) => getOuraRawSamplesForTags(...a),
    listSleepSessions: (...a: unknown[]) => listSleepSessions(...a),
    getColmiLatestReadingAt: (u: string) => getColmiLatestReadingAt(u),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/health/daytime-hrv', () => ({
  daytimeHrvCurve: (s: Row[], sleep: Row[]) => daytimeHrvCurve(s, sleep),
}))
vi.mock('@trainingai/shared/health/intraday-temp', () => ({
  intradayTempCurve: (s: Row[]) => intradayTempCurve(s),
}))
vi.mock('@trainingai/shared/health/intraday-spo2', () => ({
  intradaySpo2Curve: (s: Row[]) => intradaySpo2Curve(s),
}))
vi.mock('@trainingai/shared/health/wear-confidence', () => ({
  completenessForDay: (i: Row) => completenessForDay(i),
}))

import { GET as rekeyGet, POST as rekeyPost, DELETE as rekeyDelete } from '@/app/api/oura-ble/rekey/route'
import { GET as metricsGet } from '@/app/api/oura-ble/device-metrics/route'
import { GET as colmiGet } from '@/app/api/colmi/status/route'

const rekeyReq = (body?: unknown) =>
  rekeyPost(new Request('http://localhost/api/oura-ble/rekey', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

const metricsReq = (qs = '') =>
  metricsGet(new Request(`http://localhost/api/oura-ble/device-metrics${qs}`))

/** A raw sample row at a given user-local wall clock on a given Brisbane day. */
const sample = (tag: number, iso: string, decoded: Row | null = null) =>
  ({ tag, measuredAt: iso, decoded, ringTimestampDs: 0, eventName: 'x' })

beforeEach(() => {
  for (const m of [getUserById, rateLimit, getPendingRekeyDeclaration, declareOuraRekey,
                   cancelPendingRekeyDeclaration, getOuraRawSamplesForTags, listSleepSessions,
                   getColmiLatestReadingAt, daytimeHrvCurve, intradayTempCurve, intradaySpo2Curve,
                   completenessForDay]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getPendingRekeyDeclaration.mockResolvedValue(null)
  declareOuraRekey.mockResolvedValue({
    id: 'rk-1', declaredAt: new Date('2026-09-09T04:00:00Z'), alreadyPending: false,
  })
  cancelPendingRekeyDeclaration.mockResolvedValue(true)
  getOuraRawSamplesForTags.mockResolvedValue([])
  listSleepSessions.mockResolvedValue([])
  getColmiLatestReadingAt.mockResolvedValue(null)
  daytimeHrvCurve.mockImplementation((s: Row[]) => s)
  intradayTempCurve.mockImplementation((s: Row[]) => s)
  intradaySpo2Curve.mockImplementation((s: Row[]) => s)
  completenessForDay.mockImplementation((i: Row) => ({ ...i, pct: 50 }))
  sessionUser = { id: 'u-1', isAdmin: true }
})

afterEach(() => { vi.useRealTimers() })

describe('the gate — and where it deliberately differs', () => {
  const ADMIN_ONLY: [string, () => Promise<Response>][] = [
    ['rekey GET', () => rekeyGet()],
    ['rekey POST', () => rekeyReq()],
    ['rekey DELETE', () => rekeyDelete()],
    ['device-metrics GET', () => metricsReq()],
  ]

  it('refuses a non-admin on the three ring routes, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ADMIN_ONLY) expect((await call()).status, name).toBe(403)
    expect(declareOuraRekey).not.toHaveBeenCalled()
    expect(cancelPendingRekeyDeclaration).not.toHaveBeenCalled()
  })

  it('lets a non-admin read their OWN colmi status — the asymmetry is the design', async () => {
    // `colmi/status` is a signed-in user's own ring, not an admin diagnostic. Gating it would break
    // it for everyone but the owner, and its neighbours here being admin-only is what makes the
    // difference easy to erase by accident.
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await colmiGet()).status).toBe(200)
    expect(getColmiLatestReadingAt).toHaveBeenCalledWith('u-1')
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ADMIN_ONLY) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 401 with no session on all four', async () => {
    sessionUser = null
    for (const [name, call] of [...ADMIN_ONLY, ['colmi GET', () => colmiGet()]] as [string, () => Promise<Response>][]) {
      expect((await call()).status, name).toBe(401)
    }
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('/api/oura-ble/rekey — declaring, not performing', () => {
  it('reports no pending declaration as null rather than 404', async () => {
    const res = await rekeyGet()
    expect(await res.json()).toEqual({ pending: null })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('reports a pending one with its id and declaration time', async () => {
    getPendingRekeyDeclaration.mockResolvedValue({
      id: 'rk-9', declaredAt: new Date('2026-09-08T22:15:00Z'),
    })
    expect(await (await rekeyGet()).json()).toEqual({
      pending: { id: 'rk-9', declaredAt: '2026-09-08T22:15:00.000Z' },
    })
  })

  it('declares with no body, which is the normal case', async () => {
    const body = await (await rekeyReq()).json()
    expect(declareOuraRekey).toHaveBeenCalledWith('u-1', null)
    expect(body).toMatchObject({ id: 'rk-1', alreadyPending: false })
    expect(body.note).toContain('next ingest batch')
  })

  it('is idempotent, and SAYS which of the two happened', async () => {
    // The effect is deferred until the ring next reports, so from the outside "queued" and "already
    // waiting" produce identical observable state. Without the flag and its sentence, pressing the
    // button twice looks like it worked twice.
    declareOuraRekey.mockResolvedValue({
      id: 'rk-1', declaredAt: new Date('2026-09-09T04:00:00Z'), alreadyPending: true,
    })
    const body = await (await rekeyReq()).json()
    expect(body.alreadyPending).toBe(true)
    expect(body.note).toContain('did not queue a second one')
  })

  it('keeps an optional note, truncated to 500 characters', async () => {
    await rekeyReq({ note: 'rekeyed with open_oura after battery death' })
    expect(declareOuraRekey).toHaveBeenCalledWith('u-1', 'rekeyed with open_oura after battery death')
    declareOuraRekey.mockClear()
    await rekeyReq({ note: 'x'.repeat(900) })
    expect((declareOuraRekey.mock.calls[0] as unknown[])[1]).toHaveLength(500)
  })

  it('treats a non-string note as absent rather than stringifying it', async () => {
    for (const note of [42, null, { text: 'hi' }] as unknown[]) {
      declareOuraRekey.mockClear()
      await rekeyReq({ note })
      expect((declareOuraRekey.mock.calls[0] as unknown[])[1], String(note)).toBeNull()
    }
  })

  it('accepts an unreadable body but refuses an oversized one', async () => {
    // No body is normal here, so an unparseable one falls through to "no note" rather than 400 —
    // only a body too large to read is refused.
    const unreadable = await rekeyPost(new Request('http://localhost/api/oura-ble/rekey', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
    }))
    expect(unreadable.status).toBe(200)
    expect(declareOuraRekey).toHaveBeenCalledWith('u-1', null)

    declareOuraRekey.mockClear()
    const big = await rekeyReq({ note: 'x'.repeat(5 * 1024) })
    expect(big.status).toBe(413)
    expect(declareOuraRekey).not.toHaveBeenCalled()
  })

  it('rate-limits the declaration but not the read', async () => {
    rateLimit.mockReturnValue(false)
    expect((await rekeyReq()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([5, 60_000])
    expect((await rekeyGet()).status).toBe(200)
    expect((await rekeyDelete()).status).toBe(200)
    expect(declareOuraRekey).not.toHaveBeenCalled()
  })

  it('cancels a pending declaration, and says so when there was nothing to cancel', async () => {
    // Two different outcomes behind one 200, and they must be distinguishable: a consumed
    // declaration is deliberately NOT cancellable, because the epoch it opened already exists and
    // every timestamp derived from it depends on that row as the audit trail. "Nothing was pending"
    // is what an owner sees when they try anyway.
    const done = await (await rekeyDelete()).json()
    expect(done).toEqual({ cancelled: true, note: 'Pending declaration removed.' })

    cancelPendingRekeyDeclaration.mockResolvedValue(false)
    const none = await (await rekeyDelete()).json()
    expect(none).toEqual({ cancelled: false, note: 'Nothing was pending.' })
  })
})

describe('GET /api/oura-ble/device-metrics', () => {
  it('defaults to 3 days and clamps a request to 14', async () => {
    await metricsReq()
    expect((getOuraRawSamplesForTags.mock.calls[0] as unknown[])[2]).toBe(3)
    getOuraRawSamplesForTags.mockClear()
    await metricsReq('?days=30')
    expect((getOuraRawSamplesForTags.mock.calls[0] as unknown[])[2]).toBe(14)
    getOuraRawSamplesForTags.mockClear()
    await metricsReq('?days=0')
    expect((getOuraRawSamplesForTags.mock.calls[0] as unknown[])[2]).toBe(1)
  })

  it('falls back to the default for a days it cannot use, instead of passing NaN', async () => {
    // `Math.min(14, Math.max(1, NaN))` is NaN, and the adapter's own clamp is the same three
    // functions, so NaN used to survive both and reach `Date.now() - NaN * 86_400_000`. The panel
    // then read empty — a diagnostic answering "no data" where the truth was three days of it.
    for (const qs of ['?days=abc', '?days=NaN', '?days=one']) {
      getOuraRawSamplesForTags.mockClear()
      await metricsReq(qs)
      expect((getOuraRawSamplesForTags.mock.calls[0] as unknown[])[2], qs).toBe(3)
    }
  })

  it('asks for the biometric tag set, not one tag at a time', async () => {
    await metricsReq()
    const tags = (getOuraRawSamplesForTags.mock.calls[0] as unknown[])[1] as number[]
    expect(tags).toEqual(expect.arrayContaining([0x5d, 0x8b, 0x46, 0x69]))
    expect(tags.length).toBeGreaterThan(4)
  })

  it('buckets by user-local day, newest first, and skips a row with no measured time', async () => {
    // A row without `measuredAt` cannot be placed on any day; keeping it would put an unplaced
    // sample into whichever bucket happened to be built first.
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x5d, '2026-09-06T02:00:00Z', { rmssd_ms: [40] }),
      sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [45] }),
      { tag: 0x5d, measuredAt: null, decoded: { rmssd_ms: [99] }, ringTimestampDs: 0, eventName: 'x' },
    ])
    const body = await (await metricsReq()).json()
    // 02:00 UTC is midday Brisbane, so each row lands on its own local day, newest first.
    expect(body.days.map((d: Row) => d.date)).toEqual(['2026-09-07', '2026-09-06'])
  })

  it('routes each tag to its own curve and drops a sample whose values average to nothing', async () => {
    // A decoded body carrying an empty array averages to null. Keeping it would put a `null` into
    // a numeric curve; dropping it is why the filter exists, and a fixture where every sample had
    // values could not tell the two apart.
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [40, 60] }),
      sample(0x5d, '2026-09-07T03:00:00Z', { rmssd_ms: [] }),
      sample(0x46, '2026-09-07T02:00:00Z', { temps_c: [36.5, 36.7] }),
      sample(0x8b, '2026-09-07T02:00:00Z', { r: [0.8] }),
    ])
    await metricsReq()
    expect(daytimeHrvCurve.mock.calls[0][0]).toEqual([{ tSec: 43_200, rmssd: 50 }])
    expect(intradayTempCurve.mock.calls[0][0]).toEqual([{ tSec: 43_200, tempC: 36.6 }])
    expect(intradaySpo2Curve.mock.calls[0][0]).toEqual([{ tSec: 43_200, r: 0.8 }])
  })

  it('ignores non-numeric entries inside a decoded array', async () => {
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [40, 'x', null, 60] }),
    ])
    await metricsReq()
    expect(daytimeHrvCurve.mock.calls[0][0]).toEqual([{ tSec: 43_200, rmssd: 50 }])
  })

  it('treats BOTH temperature tags as temperature', async () => {
    // Two tags carry it, and a fixture using only one could not tell the array from a single value.
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x46, '2026-09-07T02:00:00Z', { temps_c: [36.0] }),
      sample(0x69, '2026-09-07T03:00:00Z', { temps_c: [37.0] }),
    ])
    await metricsReq()
    expect(intradayTempCurve.mock.calls[0][0]).toHaveLength(2)
  })

  it('selects the day’s sleep by its DATE field, not by whether the times happen to clamp', async () => {
    // **The second session is the whole test, and the obvious version of it tests nothing.** A
    // wrong-day session whose times also fall outside this day clamps to a zero-length window and is
    // dropped by the NEXT filter — so removing the date filter changes nothing and the case passes
    // either way. (Measured: that mutant survived.) This one is dated to the 6th while its times sit
    // inside the 7th, so only the date field can exclude it.
    getOuraRawSamplesForTags.mockResolvedValue([sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [50] })])
    listSleepSessions.mockResolvedValue([
      { date: '2026-09-07', sleepStart: new Date('2026-09-06T20:00:00Z'), sleepEnd: new Date('2026-09-06T21:00:00Z') },
      { date: '2026-09-06', sleepStart: new Date('2026-09-06T23:00:00Z'), sleepEnd: new Date('2026-09-07T00:00:00Z') },
    ])
    await metricsReq()
    const sleep = daytimeHrvCurve.mock.calls[0][1] as { startSec: number; endSec: number }[]
    expect(sleep).toHaveLength(1)
    // 20:00 UTC on the 6th is 06:00 Brisbane on the 7th — 21,600 s past local midnight.
    expect(sleep[0]).toEqual({ startSec: 21_600, endSec: 25_200 })
  })

  it('drops a sleep interval that clamps to nothing', async () => {
    // A session entirely before the day's local midnight clamps to a zero- or negative-length
    // window, which would otherwise mask nothing while claiming to mask something.
    getOuraRawSamplesForTags.mockResolvedValue([sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [50] })])
    listSleepSessions.mockResolvedValue([
      { date: '2026-09-07', sleepStart: new Date('2026-09-05T10:00:00Z'), sleepEnd: new Date('2026-09-05T11:00:00Z') },
    ])
    await metricsReq()
    expect(daytimeHrvCurve.mock.calls[0][1]).toEqual([])
  })

  it('measures TODAY against the bins elapsed so far, not a full day', async () => {
    // The partial-day rule. A cumulative per-day figure compared against a completed-day expectation
    // reads as an anomaly every time it is looked at before midnight — here, as a wear failure.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T02:00:00Z')) // midday Brisbane, 48 of 96 bins elapsed
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x5d, '2026-09-07T01:00:00Z', { rmssd_ms: [50] }),
      sample(0x5d, '2026-09-06T01:00:00Z', { rmssd_ms: [50] }),
    ])
    await metricsReq()
    const [today, yesterday] = completenessForDay.mock.calls.map(c => c[0] as Row)
    expect(today.expectedBins).toBe(48)
    expect(yesterday.expectedBins).toBe(96)
    expect(today.binMinutes).toBe(15)
  })

  it('counts each 15-minute bin once, however many samples land in it', async () => {
    // Wear is "was the ring on during this bin", not "how many frames arrived" — a burst of frames
    // in one bin is one bin's worth of evidence.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-08T02:00:00Z'))
    getOuraRawSamplesForTags.mockResolvedValue([
      sample(0x5d, '2026-09-07T02:00:00Z', { rmssd_ms: [50] }),
      sample(0x5d, '2026-09-07T02:05:00Z', { rmssd_ms: [50] }),
      sample(0x5d, '2026-09-07T03:00:00Z', { rmssd_ms: [50] }),
    ])
    await metricsReq()
    expect((completenessForDay.mock.calls[0][0] as { wornBinIndices: number[] }).wornBinIndices)
      .toEqual([48, 52])
  })

  it('returns an empty day list rather than failing when nothing was recorded', async () => {
    const body = await (await metricsReq()).json()
    expect(body).toEqual({ days: [] })
  })

  it('uses the caller’s timezone for the day boundary', async () => {
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Etc/GMT-12' }
    getOuraRawSamplesForTags.mockResolvedValue([sample(0x5d, '2026-09-06T13:00:00Z', { rmssd_ms: [50] })])
    const body = await (await metricsReq()).json()
    // 13:00 UTC on the 6th is 01:00 on the 7th at UTC+12, and 23:00 on the 6th in Brisbane.
    expect(body.days[0].date).toBe('2026-09-07')
  })
})

describe('GET /api/colmi/status', () => {
  it('reports the latest reading as an ISO string', async () => {
    getColmiLatestReadingAt.mockResolvedValue(new Date('2026-09-08T22:15:00Z'))
    expect(await (await colmiGet()).json()).toEqual({ latestReadingAt: '2026-09-08T22:15:00.000Z' })
  })

  it('reports never-synced as null rather than omitting the key', async () => {
    // The screen distinguishes "no reading yet" from "the field is missing"; an absent key reads
    // as the second and renders as a loading state that never resolves.
    expect(await (await colmiGet()).json()).toEqual({ latestReadingAt: null })
  })

  it('rate-limits generously, because the app polls it', async () => {
    rateLimit.mockReturnValue(false)
    expect((await colmiGet()).status).toBe(429)
    expect(rateLimit.mock.calls[0].slice(1)).toEqual([120, 60_000])
    expect(getColmiLatestReadingAt).not.toHaveBeenCalled()
  })
})
