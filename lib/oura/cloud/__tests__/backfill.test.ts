// The history read (#2859) with Oura mocked at `fetch` and a fake repository: ranges, a dry run,
// and how it stops. The Postgres half (idempotency, provenance) is
// `lib/data/postgres/__tests__/oura-cloud-ingest-2859.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_API_BASE, type OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { backfillOuraCloud, validBackfillRange, type OuraBackfillDeps } from '../backfill'
import { FIXTURES, heartRateRows, jsonResponse } from './fixtures'

const USER = '11111111-1111-4111-8111-111111111111'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://localhost:3000/api/oura/callback' }
const fetchMock = vi.fn<typeof fetch>()

function fakeRepo(connected = true) {
  const calls: string[] = []
  const row: OuraCloudTokenRow | null = connected ? {
    userId: USER,
    accessToken: encryptOuraToken('acc', USER, 'access_token'),
    refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
    expiresAt: new Date(Date.now() + 86_400_000), scope: 'daily', ouraUserId: 'o', updatedAt: new Date(),
  } : null
  const repo: OuraBackfillDeps['repo'] = {
    getOuraCloudTokens: async () => row,
    saveOuraCloudTokens: async () => {},
    deleteOuraCloudTokens: async () => true,
    upsertOuraDaily: async (_u, rows) => { calls.push(`daily:${rows.length}`) },
    upsertBodyMetrics: async (_u, rows) => { calls.push(`body:${rows.length}`) },
    upsertOuraCloudSleep: async (_u, rows) => { calls.push(`sleep:${rows.length}`); return { written: rows.length, skippedOverlap: 0 } },
    tombstoneOuraCloudSleep: async (_u, ids) => ids.length,
    upsertOuraWorkouts: async (_u, rows) => { calls.push(`workouts:${rows.length}`); return rows.length },
    upsertOuraCloudHeartrate: async (_u, rows) => { calls.push(`hr:${rows.length}`); return rows.length },
  }
  return { repo, calls }
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
    expect(out.report.documents).toMatchObject({ daily_readiness: 1, sleep: 1, workout: 1, heartrate: 4 })
    expect(out.report.counts).toMatchObject({ dailyRows: 1, bodyRows: 1, sleepWritten: 1, workouts: 1, heartRatePoints: 4 })
    expect(calls).toEqual(['daily:1', 'body:1', 'sleep:1', 'workouts:1', 'hr:2', 'hr:2'])
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

  it('stops on a 429, writes what it read, and says why', async () => {
    oura(path => (path === 'sleep' ? new Response('', { status: 429 }) : null))
    const { repo, calls } = fakeRepo()
    const out = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...OPTS, dryRun: false })
    expect(out.ok && out.report.stoppedEarly).toMatch(/429/)
    expect(out.ok && out.report.documents.workout).toBeUndefined()
    expect(calls).toContain('daily:1')
    expect(calls.some(c => c.startsWith('hr:'))).toBe(false)
  })

  it('refuses without a connection, and a range that is backwards or too long', async () => {
    expect(await backfillOuraCloud({ repo: fakeRepo(false).repo, config: CONFIG }, USER, { ...OPTS, dryRun: true })).toEqual({ ok: false, error: 'not_connected' })
    expect(await backfillOuraCloud({ repo: fakeRepo().repo, config: CONFIG }, USER, { ...OPTS, from: '2026-10-12', to: '2026-10-01', dryRun: true })).toEqual({ ok: false, error: 'invalid_range' })
    expect(validBackfillRange('2025-01-01', '2026-10-12')).toBe(false)
    expect(validBackfillRange('2026-10-12', '2026-10-12')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
