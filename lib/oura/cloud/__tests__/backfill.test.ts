// The history read (#2859) with Oura mocked at `fetch` and a fake repository: ranges, a dry run,
// and how it stops. The Postgres half (idempotency, provenance) is
// `lib/data/postgres/__tests__/oura-cloud-ingest-2859.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_API_BASE, type OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { backfillOuraCloud, MAX_RATE_LIMIT_WAITS, startOuraConnectBackfill, validBackfillRange, type OuraBackfillDeps } from '../backfill'
import { parseRetryAfter } from '../data'
import { resetOuraCloudReportThrottle } from '../report'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
let dataRepo: unknown = null
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => dataRepo }))
import { FIXTURES, heartRateRows, jsonResponse } from './fixtures'

const USER = '11111111-1111-4111-8111-111111111111'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://localhost:3000/api/oura/callback' }
const fetchMock = vi.fn<typeof fetch>()

/** Everything we ask for, as Oura spells it in the token answer. */
const FULL_SCOPE = 'extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session extapi:spo2 extapi:heart_health'

function fakeRepo(connected = true, scope: string | null = FULL_SCOPE) {
  const calls: string[] = []
  const absent: { from: string; to: string; keepIds: string[] }[] = []
  const row: OuraCloudTokenRow | null = connected ? {
    userId: USER,
    accessToken: encryptOuraToken('acc', USER, 'access_token'),
    refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
    expiresAt: new Date(Date.now() + 86_400_000), scope, ouraUserId: 'o', updatedAt: new Date(), reauthRequiredAt: null,
  } : null
  const repo: OuraBackfillDeps['repo'] = {
    getOuraCloudTokens: async () => row,
    saveOuraCloudTokens: async () => {},
    markOuraCloudReauthRequired: async () => { calls.push('marked'); return true },
    deleteOuraCloudTokens: async () => true,
    getUserIdByOuraUserId: async () => (connected ? USER : null),
    upsertOuraDaily: async (_u, rows) => { calls.push(`daily:${rows.length}`) },
    upsertBodyMetrics: async (_u, rows) => { calls.push(`body:${rows.length}`) },
    upsertOuraCloudSleep: async (_u, rows) => { calls.push(`sleep:${rows.length}`); return { written: rows.length, skippedOverlap: 0 } },
    tombstoneOuraCloudSleep: async (_u, ids) => ids.length,
    syncOuraMainSleepBodyMetrics: async () => ({ written: 0, cleared: 0 }),
    upsertOuraWorkouts: async (_u, rows) => { calls.push(`workouts:${rows.length}`); return rows.length },
    tombstoneOuraWorkouts: async (_u, ids) => ids.length,
    tombstoneOuraWorkoutsAbsent: async (_u, range) => { absent.push(range); return 1 },
    upsertOuraCloudHeartrate: async (_u, rows) => { calls.push(`hr:${rows.length}`); return { offered: rows.length, changed: rows.length, changedFrom: rows[0]?.timestamp ?? null, changedTo: rows[rows.length - 1]?.timestamp ?? null } },
    upsertOuraCloudSleepPeriods: async (_u, rows) => { calls.push(`periods:${rows.length}`); return rows.length },
    upsertOuraCloudDaily: async (_u, rows) => { calls.push(`cloudDaily:${rows.length}`); return rows.length },
    upsertOuraSessions: async (_u, rows) => { calls.push(`sessions:${rows.length}`); return rows.length },
  }
  return { repo, calls, absent }
}

/** Answers every collection with its one fixture, and heart rate with two points. */
function oura(over: (path: string) => Response | null = () => null) {
  fetchMock.mockImplementation(async input => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/v2/usercollection/', '')
    const custom = over(path)
    if (custom) return custom
    if (path === 'heartrate') return jsonResponse({ data: heartRateRows, next_token: null })
    const type = path === 'vO2_max' ? 'vo2_max' : path
    const doc = (FIXTURES as Record<string, unknown>)[type]
    return jsonResponse({ data: doc ? [doc] : [], next_token: null })
  })
}

const OPTS = { from: '2026-10-01', to: '2026-10-12', heartRate: true, tz: 'Australia/Brisbane' }

describe('backfillOuraCloud (#2859)', () => {
  const savedKey = process.env.OURA_TOKEN_KEY
  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    process.env.OURA_TOKEN_KEY = savedKey
    vi.unstubAllGlobals()
  })

  it('reads every type over the range and writes once', async () => {
    oura()
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.report.documents).toMatchObject({ daily_readiness: 1, sleep: 1, workout: 1, session: 1, heartrate: 4 })
    expect(out.report.counts).toMatchObject({
      dailyRows: 1, bodyRows: 1, sleepWritten: 1, workouts: 1, heartRatePoints: 4, sleepPeriods: 1, cloudDays: 1, sessions: 1,
    })
    expect(calls).toEqual(['daily:1', 'body:1', 'periods:1', 'sleep:1', 'workouts:1', 'cloudDaily:1', 'sessions:1', 'hr:2', 'hr:2'])
    const first = new URL(String(fetchMock.mock.calls[0][0]))
    expect(first.href.startsWith(`${OURA_API_BASE}/v2/usercollection/daily_readiness`)).toBe(true)
    expect(Object.fromEntries(first.searchParams)).toEqual({ start_date: '2026-10-01', end_date: '2026-10-12' })
    // Heart rate in 7-day windows, from local midnight to local midnight (Brisbane is UTC+10).
    const hr = fetchMock.mock.calls.map(c => new URL(String(c[0]))).filter(u => u.pathname.endsWith('/heartrate'))
    expect(hr.map(u => [u.searchParams.get('start_datetime'), u.searchParams.get('end_datetime')])).toEqual([
      ['2026-09-30T14:00:00.000Z', '2026-10-07T14:00:00.000Z'],
      ['2026-10-07T14:00:00.000Z', '2026-10-12T14:00:00.000Z'],
    ])
  })

  it('a dry run reads and reports, and writes nothing', async () => {
    oura()
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })
    expect(out.ok && out.report.counts).toMatchObject({ dailyRows: 1, sleepWritten: 1, heartRatePoints: 4 })
    expect(calls).toEqual([])
  })

  it('follows next_token across pages', async () => {
    let page = 0
    oura(path => {
      if (path !== 'workout') return null
      page++
      return page === 1
        ? jsonResponse({ data: [FIXTURES.workout], next_token: 'p2' })
        : jsonResponse({ data: [{ ...FIXTURES.workout, id: 'wo-2' }], next_token: null })
    })
    const { repo } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: true, heartRate: false })
    expect(out.ok && out.report.documents.workout).toBe(2)
    const second = fetchMock.mock.calls.map(c => new URL(String(c[0]))).filter(u => u.pathname.endsWith('/workout'))[1]
    expect(second.searchParams.get('next_token')).toBe('p2')
  })

  it('skips a type Oura refuses (403) and carries on', async () => {
    oura(path => (path === 'daily_spo2' ? new Response('', { status: 403 }) : null))
    const { repo } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok && out.report.forbidden).toEqual(['daily_spo2'])
    expect(out.ok && out.report.documents.workout).toBe(1)
  })

  // #2974, #3026: the owner's 18 Oct grant, which carries neither spo2 nor heart_health. Oura's 401s
  // for those types are what it does for a scope not granted, so they read as not shared, never as
  // refused despite the grant, and nothing reads them.
  it('skips the types the grant does not cover, reads the rest and heart rate, and reports them as not shared', async () => {
    const ungranted = ['daily_spo2', 'daily_resilience', 'daily_cardiovascular_age', 'vO2_max']
    oura(path => (ungranted.includes(path) ? new Response('', { status: 401 }) : null))
    const { repo, calls } = fakeRepo(true, 'extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session')
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.report.notShared).toEqual(['daily_spo2', 'daily_resilience', 'daily_cardiovascular_age', 'vo2_max'])
    expect(out.report.refusedDespiteGrant).toEqual([])
    expect(out.report.stoppedEarly).toBeNull()
    expect(out.report.documents).toMatchObject({ daily_readiness: 1, daily_stress: 1, sleep: 1, workout: 1, heartrate: 4 })
    for (const type of ['daily_spo2', 'daily_resilience', 'daily_cardiovascular_age', 'vo2_max'] as const) {
      expect(out.report.documents[type]).toBeUndefined()
    }
    expect(fetchMock.mock.calls.some(c => ungranted.some(p => String(c[0]).includes(`/${p}`)))).toBe(false)
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/personal_info'))).toBe(false)
    expect(calls).toContain('hr:2')
  })

  it('reads SpO2 under a grant stored with the old spo2Daily name', async () => {
    oura()
    const { repo } = fakeRepo(true, 'extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session extapi:spo2Daily')
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })
    expect(out.ok && out.report.documents.daily_spo2).toBe(1)
    expect(out.ok && out.report.notShared).toEqual(['daily_resilience', 'daily_cardiovascular_age', 'vo2_max'])
  })

  it('skips the heart-rate pass when heartrate is not shared', async () => {
    oura()
    const { repo, calls } = fakeRepo(true, 'extapi:daily extapi:workout extapi:spo2 extapi:heart_health')
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    // `session` too: this grant leaves it out (#2982 reads sessions).
    expect(out.ok && out.report.notShared).toEqual(['session', 'heartrate'])
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/heartrate'))).toBe(false)
    expect(calls.some(c => c.startsWith('hr:'))).toBe(false)
  })

  it('still stops on a 401 for a type the grant covers when the token itself is refused', async () => {
    oura(path => {
      if (path === '/oauth/token') return jsonResponse({ error: 'invalid_grant' }, 400)
      return path === 'sleep' || path === 'personal_info' ? new Response('', { status: 401 }) : null
    })
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok && out.report.stoppedEarly).toMatch(/connect again/)
    // #3204: the refresh Oura refused is recorded, so the connection stops reading as connected.
    expect(calls).toContain('marked')
    expect(out.ok && out.report.notShared).toEqual([])
    expect(out.ok && out.report.refusedDespiteGrant).toEqual([])
    expect(out.ok && out.report.documents.workout).toBeUndefined()
    expect(calls.some(c => c.startsWith('hr:'))).toBe(false)
  })

  // #3204: the old access token alone was dead. The run holds it, so it stops, and records nothing.
  it('stops without recording anything when a refresh brings a token that works', async () => {
    let refreshed = false
    oura(path => {
      if (path === '/oauth/token') { refreshed = true; return jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }) }
      if (path === 'personal_info') return refreshed ? jsonResponse({ id: 'o', age: 40 }) : new Response('', { status: 401 })
      return path === 'sleep' ? new Response('', { status: 401 }) : null
    })
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok && out.report.stoppedEarly).toMatch(/a fresh one is stored/)
    expect(calls).not.toContain('marked')
  })

  // #2975 review: the spec names no scope for stress, so `daily` is a guess. If Oura gates it
  // differently, a live token must not stop the run before sleep, workouts and heart rate.
  it('carries on past a 401 on a granted type when personal_info shows the token is alive', async () => {
    oura(path => {
      if (path === 'daily_stress') return new Response('', { status: 401 })
      if (path === 'personal_info') return jsonResponse({ id: 'o', age: 40 })
      return null
    })
    const { repo, calls } = fakeRepo(true, FULL_SCOPE)
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.report.stoppedEarly).toBeNull()
    expect(out.report.refusedDespiteGrant).toEqual(['daily_stress'])
    expect(out.report.documents).toMatchObject({
      daily_resilience: 1, daily_cardiovascular_age: 1, vo2_max: 1, sleep: 1, workout: 1, heartrate: 4,
    })
    expect(calls).toContain('hr:2')
    // One probe for the run, not one per refused request.
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/personal_info'))).toHaveLength(1)
  })

  it('stops with the probe\'s reason when personal_info cannot be read', async () => {
    oura(path => {
      if (path === 'daily_stress') return new Response('', { status: 401 })
      if (path === 'personal_info') return new Response('', { status: 503 })
      return null
    })
    const out = await backfillOuraCloud({ repo: fakeRepo().repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })
    expect(out.ok && out.report.stoppedEarly).toMatch(/personal_info answered 503/)
    expect(out.ok && out.report.documents.sleep).toBeUndefined()
  })

  it('tries every type when the grant has no scope string (a legacy row)', async () => {
    oura()
    const { repo } = fakeRepo(true, null)
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })
    expect(out.ok && out.report.notShared).toEqual([])
    expect(out.ok && out.report.documents).toMatchObject({ daily_spo2: 1, workout: 1, heartrate: 4 })
  })

  it('stops on a 429, writes what it read, and says why', async () => {
    oura(path => (path === 'sleep' ? new Response('', { status: 429 }) : null))
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok && out.report.stoppedEarly).toMatch(/429/)
    expect(out.ok && out.report.documents.workout).toBeUndefined()
    expect(calls).toContain('daily:1')
    expect(calls.some(c => c.startsWith('hr:'))).toBe(false)
  })

  // #2895 review, nit 9: a short Retry-After is waited out and the same page read again.
  it('waits out a short Retry-After and carries on', async () => {
    let limited = true
    oura(path => {
      if (path === 'sleep' && limited) { limited = false; return new Response('', { status: 429, headers: { 'Retry-After': '2' } }) }
      return null
    })
    const waited: number[] = []
    const { repo } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG, wait: async ms => { waited.push(ms) } }, USER, { ...OPTS, dryRun: false })
    expect(waited).toEqual([2000])
    expect(out.ok && out.report.stoppedEarly).toBeNull()
    expect(out.ok && out.report.documents.sleep).toBe(1)
  })

  it('stops on a long Retry-After, and after a few waits, saying how long Oura asked for', async () => {
    oura(path => (path === 'sleep' ? new Response('', { status: 429, headers: { 'Retry-After': '600' } }) : null))
    const waited: number[] = []
    let out = await backfillOuraCloud({ repo: fakeRepo().repo, config: CONFIG, wait: async ms => { waited.push(ms) } }, USER, { ...OPTS, dryRun: true })
    expect(waited).toEqual([])
    expect(out.ok && out.report.stoppedEarly).toMatch(/429 \(retry after 600 s\)/)

    oura(path => (path === 'sleep' ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : null))
    out = await backfillOuraCloud({ repo: fakeRepo().repo, config: CONFIG, wait: async ms => { waited.push(ms) } }, USER, { ...OPTS, dryRun: true })
    expect(waited).toHaveLength(MAX_RATE_LIMIT_WAITS)
    expect(out.ok && out.report.stoppedEarly).toMatch(/429/)
  })

  it('reads Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-10-14T02:00:00Z')
    expect(parseRetryAfter('30', now)).toBe(30_000)
    expect(parseRetryAfter('Wed, 14 Oct 2026 02:00:45 GMT', now)).toBe(45_000)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })

  it('refuses without a connection, and a range that is backwards or too long', async () => {
    expect(await backfillOuraCloud({ repo: fakeRepo(false).repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })).toEqual({ ok: false, error: 'not_connected' })
    expect(await backfillOuraCloud({ repo: fakeRepo().repo, config: CONFIG }, USER, { ...OPTS, from: '2026-10-12', to: '2026-10-01', dryRun: true })).toEqual({ ok: false, error: 'invalid_range' })
    expect(validBackfillRange('2025-01-01', '2026-10-12')).toBe(false)
    expect(validBackfillRange('2026-10-12', '2026-10-12')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// #2895 review, item 5: a connect whose history read did not finish is recorded, not just logged.
describe('startOuraConnectBackfill reporting', () => {
  // The connect backfill passes the repository as the night re-scorer (#3079); an empty store.
  const rescore = {
    withOuraSleepWriteLock: <T,>(_u: string, run: () => Promise<T>) => run(),
    listDeletedOuraCloudSleepDates: async () => [],
    listSleepSessions: async () => [], getOuraDailyDerived: async () => [],
    upsertOuraDailyDerived: async () => {}, clearNightDerivedScores: async () => false, releaseBodyBatteryAnchor: async () => false,
  }
  const saved: Record<string, string | undefined> = {}
  const ENV = { OURA_CLIENT_ID: 'cid', OURA_CLIENT_SECRET: 'cs', OURA_REDIRECT_URI: 'http://localhost:3000/api/oura/callback', OURA_TOKEN_KEY: 'k'.repeat(48) }
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v }
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    reportServerError.mockReset()
    resetOuraCloudReportThrottle()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('records a run that stopped early, with the reason and no token', async () => {
    oura(path => (path === 'sleep' ? new Response('', { status: 503 }) : null))
    dataRepo = { ...rescore, ...fakeRepo().repo, getUserById: async () => ({ id: USER, timezone: null }) }
    startOuraConnectBackfill(USER)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalled())
    const [err, ctx] = reportServerError.mock.calls[0] as [Error, { userId: string }]
    expect(err.message).toMatch(/connect-backfill:stopped-early: Oura's sleep answered 503/)
    expect(err.message).not.toContain('acc')
    expect(ctx.userId).toBe(USER)
  })

  // #2982: a refused type and an empty heart-rate pass were visible only in a report nobody reads.
  it('records a type Oura refused, and a heart-rate pass that read nothing', async () => {
    oura(path => {
      if (path === 'daily_spo2') return new Response('', { status: 403 })
      if (path === 'heartrate') return jsonResponse({ data: [], next_token: null })
      return null
    })
    dataRepo = { ...rescore, ...fakeRepo().repo, getUserById: async () => ({ id: USER, timezone: 'Australia/Brisbane' }) }
    startOuraConnectBackfill(USER)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(2))
    const messages = reportServerError.mock.calls.map(c => (c[0] as Error).message)
    expect(messages[0]).toMatch(/connect-backfill:forbidden: Oura refused daily_spo2 \(403\)/)
    expect(messages[1]).toMatch(/connect-backfill:heartrate-empty: Oura answered no heart rate for /)
  })

  // #3078: the connect backfill re-attributes the workouts its heart rate changed, like the catch-up.
  it('records nothing extra for a full, clean connect backfill, and re-attributes workouts over its heart rate', async () => {
    oura()
    const { repo, calls } = fakeRepo()
    const overlaps: unknown[][] = []
    dataRepo = {
      ...rescore, ...repo, getUserById: async () => ({ id: USER, timezone: 'Australia/Brisbane' }),
      listCompletedSessionsOverlapping: async (...a: unknown[]) => { overlaps.push(a); return [] },
    }
    startOuraConnectBackfill(USER)
    await vi.waitFor(() => expect(calls.filter(c => c.startsWith('hr:')).length).toBeGreaterThan(0))
    await new Promise(r => setTimeout(r, 20))
    expect(reportServerError).not.toHaveBeenCalled()
    expect(overlaps.length).toBeGreaterThan(0)
    expect(overlaps[0][0]).toBe(USER)
  })

  it('records a connect whose backfill could not run', async () => {
    dataRepo = { ...rescore, ...fakeRepo(false).repo, getUserById: async () => ({ id: USER, timezone: 'Australia/Brisbane' }) }
    startOuraConnectBackfill(USER)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalled())
    expect((reportServerError.mock.calls[0][0] as Error).message).toMatch(/connect-backfill:not_connected/)
  })
})

// #3087: a workout deleted in the Oura app whose delete event was missed. The daily reconcile asks
// the read to tombstone a stored workout gone from Oura's list for a day it read whole.
describe('backfillOuraCloud tombstoneAbsentWorkouts (#3087)', () => {
  const savedKey = process.env.OURA_TOKEN_KEY
  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    process.env.OURA_TOKEN_KEY = savedKey
    vi.unstubAllGlobals()
  })
  const RANGE = { from: '2026-10-08', to: '2026-10-10', heartRate: false, tz: 'Australia/Brisbane' }

  it('hands each workout chunk it read, with the ids Oura returned, to the tombstone', async () => {
    oura()
    const { repo, absent } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...RANGE, dryRun: false, tombstoneAbsentWorkouts: true })
    // The read's last day is left out: the spec does not say `end_date` is inclusive.
    expect(absent).toEqual([{ from: '2026-10-08', to: '2026-10-09', keepIds: ['wo-1'] }])
    expect(out.ok && out.report.workoutsTombstoned).toBe(1)
  })

  it('an empty day list keeps nothing, so every stored workout on those days goes', async () => {
    oura(path => (path === 'workout' ? jsonResponse({ data: [], next_token: null }) : null))
    const { repo, absent } = fakeRepo()
    await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...RANGE, dryRun: false, tombstoneAbsentWorkouts: true })
    expect(absent).toEqual([{ from: '2026-10-08', to: '2026-10-09', keepIds: [] }])
  })

  it('a one-day read tombstones nothing: its only day is the one it may not have read', async () => {
    oura()
    const { repo, absent } = fakeRepo()
    await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...RANGE, from: '2026-10-10', dryRun: false, tombstoneAbsentWorkouts: true })
    expect(absent).toEqual([])
  })

  it('tombstones nothing unless asked, and nothing on a dry run', async () => {
    oura()
    const plain = fakeRepo()
    await backfillOuraCloud({ repo: plain.repo, config: CONFIG }, USER, { ...RANGE, dryRun: false })
    expect(plain.absent).toEqual([])
    const dry = fakeRepo()
    const out = await backfillOuraCloud({ repo: dry.repo, config: CONFIG }, USER, { ...RANGE, dryRun: true, tombstoneAbsentWorkouts: true })
    expect(dry.absent).toEqual([])
    expect(out.ok && out.report.workoutsTombstoned).toBe(0)
  })

  // A list that was not read whole says nothing about what Oura still has.
  it('skips a chunk with a document that failed the spec, and a workout read Oura refused', async () => {
    oura(path => (path === 'workout' ? jsonResponse({ data: [{ id: 'wo-bad' }], next_token: null }) : null))
    const dropped = fakeRepo()
    await backfillOuraCloud({ repo: dropped.repo, config: CONFIG }, USER, { ...RANGE, dryRun: false, tombstoneAbsentWorkouts: true })
    expect(dropped.absent).toEqual([])

    fetchMock.mockReset()
    oura(path => (path === 'workout' ? new Response('', { status: 403 }) : null))
    const refused = fakeRepo()
    await backfillOuraCloud({ repo: refused.repo, config: CONFIG }, USER, { ...RANGE, dryRun: false, tombstoneAbsentWorkouts: true })
    expect(refused.absent).toEqual([])

    const notShared = fakeRepo(true, 'extapi:personal extapi:daily extapi:heartrate extapi:session')
    fetchMock.mockReset()
    oura()
    await backfillOuraCloud({ repo: notShared.repo, config: CONFIG }, USER, { ...RANGE, dryRun: false, tombstoneAbsentWorkouts: true })
    expect(notShared.absent).toEqual([])
  })
})
