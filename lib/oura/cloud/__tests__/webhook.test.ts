// The Oura webhook's signature check and event handling (#2859), with Oura mocked at `fetch`.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_API_BASE, OURA_TOKEN_URL, type OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { OuraUnavailableError } from '../client'
import { NO_WRITES } from '../ingest'
import {
  catchUpOuraCloudHeartRate, handleOuraWebhookEvent, HEART_RATE_LOOKBACK_MS, MAX_EVENT_AGE_MS, ouraWebhookConfig,
  resetOuraCloudHeartRateThrottle, startOuraCloudHeartRateCatchUp, verifyOuraSignature, type OuraWebhookDeps,
} from '../webhook'
import type { User } from '@trainingai/shared/types'
import { resetOuraCloudReportThrottle } from '../report'
import { FIXTURES, jsonResponse, OURA_USER } from './fixtures'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const USER = '11111111-1111-4111-8111-111111111111'
const SECRET = 'csecret'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: SECRET, redirectUri: 'http://localhost:3000/api/oura/callback' }
const NOW = Date.parse('2026-10-14T02:00:00Z')

const sign = (timestamp: string, body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(timestamp + body).digest('hex').toUpperCase()

describe('verifyOuraSignature (#2859)', () => {
  const ts = String(Math.floor(NOW / 1000))
  const body = JSON.stringify({ event_type: 'update', data_type: 'sleep', object_id: 'sl-1', user_id: OURA_USER })

  it('accepts the spec\'s signature: HMAC-SHA256(client secret, timestamp + body), upper-case hex', () => {
    expect(verifyOuraSignature(SECRET, sign(ts, body), ts, body, NOW)).toBe('ok')
  })
  it('accepts lower-case hex and a sha256= prefix', () => {
    expect(verifyOuraSignature(SECRET, sign(ts, body).toLowerCase(), ts, body, NOW)).toBe('ok')
    expect(verifyOuraSignature(SECRET, `sha256=${sign(ts, body)}`, ts, body, NOW)).toBe('ok')
  })
  it('accepts a body that differs from compact JSON only in whitespace', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2)
    expect(verifyOuraSignature(SECRET, sign(ts, body), ts, pretty, NOW)).toBe('ok')
  })
  it('accepts a millisecond timestamp', () => {
    const ms = String(NOW)
    expect(verifyOuraSignature(SECRET, sign(ms, body), ms, body, NOW)).toBe('ok')
  })
  it('refuses a missing header', () => {
    expect(verifyOuraSignature(SECRET, null, ts, body, NOW)).toBe('missing')
    expect(verifyOuraSignature(SECRET, sign(ts, body), null, body, NOW)).toBe('missing')
  })
  it('refuses a wrong secret, a changed body and a changed timestamp', () => {
    expect(verifyOuraSignature(SECRET, sign(ts, body, 'other'), ts, body, NOW)).toBe('mismatch')
    expect(verifyOuraSignature(SECRET, sign(ts, body), ts, body.replace('sl-1', 'sl-2'), NOW)).toBe('mismatch')
    const later = String(Number(ts) + 1)
    expect(verifyOuraSignature(SECRET, sign(ts, body), later, body, NOW)).toBe('mismatch')
    expect(verifyOuraSignature(SECRET, 'not-hex', ts, body, NOW)).toBe('mismatch')
  })
  it('refuses a stale or future timestamp, and one that is not a number', () => {
    const old = String(Math.floor((NOW - MAX_EVENT_AGE_MS - 60_000) / 1000))
    expect(verifyOuraSignature(SECRET, sign(old, body), old, body, NOW)).toBe('stale')
    const future = String(Math.floor((NOW + 10 * 60_000) / 1000))
    expect(verifyOuraSignature(SECRET, sign(future, body), future, body, NOW)).toBe('stale')
    expect(verifyOuraSignature(SECRET, sign('soon', body), 'soon', body, NOW)).toBe('stale')
  })
})

describe('ouraWebhookConfig (#2859)', () => {
  it('is null unless the OAuth settings, callback URL and verification token are all present', () => {
    const env = { NODE_ENV: 'test', OURA_WEBHOOK_CALLBACK_URL: 'https://x.example/api/oura/webhook', OURA_WEBHOOK_VERIFICATION_TOKEN: 'vt' }
    expect(ouraWebhookConfig(CONFIG, env as NodeJS.ProcessEnv)).toMatchObject({ callbackUrl: env.OURA_WEBHOOK_CALLBACK_URL, verificationToken: 'vt' })
    expect(ouraWebhookConfig(null, env as NodeJS.ProcessEnv)).toBeNull()
    expect(ouraWebhookConfig(CONFIG, { ...env, OURA_WEBHOOK_VERIFICATION_TOKEN: ' ' } as NodeJS.ProcessEnv)).toBeNull()
    expect(ouraWebhookConfig(CONFIG, { ...env, OURA_WEBHOOK_CALLBACK_URL: 'not a url' } as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('handleOuraWebhookEvent (#2859)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const savedKey = process.env.OURA_TOKEN_KEY
  let row: OuraCloudTokenRow | null
  const writes = { daily: 0, sleep: 0, sessions: 0, tombstoned: [] as string[] }
  const heartRate = vi.fn()

  function deps(): OuraWebhookDeps {
    return {
      config: CONFIG,
      heartRate,
      repo: {
        getUserIdByOuraUserId: async id => (id === OURA_USER && row ? USER : null),
        getOuraCloudTokens: async id => (row && id === row.userId ? row : null),
        saveOuraCloudTokens: async () => {},
        deleteOuraCloudTokens: async () => true,
        upsertOuraDaily: async (_u, rows) => { writes.daily += rows.length },
        upsertBodyMetrics: async () => {},
        upsertOuraCloudSleep: async (_u, rows) => { writes.sleep += rows.length; return { written: rows.length, skippedOverlap: 0 } },
        tombstoneOuraCloudSleep: async (_u, ids) => { writes.tombstoned.push(...ids); return ids.length },
        upsertOuraWorkouts: async (_u, rows) => rows.length,
        upsertOuraCloudHeartrate: async (_u, rows) => rows.length,
        upsertOuraCloudSleepPeriods: async (_u, rows) => rows.length,
        upsertOuraCloudDaily: async (_u, rows) => rows.length,
        upsertOuraSessions: async (_u, rows) => { writes.sessions += rows.length; return rows.length },
        getLatestOuraCloudHeartrateAt: async () => null,
        getUserById: async () => ({ id: USER, timezone: 'Australia/Brisbane' }) as User,
      },
    }
  }

  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    row = {
      userId: USER,
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session extapi:spo2 extapi:heart_health',
      ouraUserId: OURA_USER, updatedAt: new Date(),
    }
    writes.daily = 0; writes.sleep = 0; writes.sessions = 0; writes.tombstoned = []
    heartRate.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    process.env.OURA_TOKEN_KEY = savedKey
    vi.unstubAllGlobals()
  })

  const event = (over: Partial<{ event_type: 'create' | 'update' | 'delete'; data_type: string; object_id: string; user_id: string }> = {}) =>
    ({ event_type: 'update' as const, data_type: 'daily_readiness', object_id: 'rd-1', user_id: OURA_USER, ...over })

  it('fetches the named document with the user\'s token and writes it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_readiness))
    const out = await handleOuraWebhookEvent(deps(), event())
    expect(out).toEqual({ result: 'written', counts: { ...NO_WRITES, dailyRows: 1, cloudDays: 1 } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${OURA_API_BASE}/v2/usercollection/daily_readiness/rd-1`)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc')
    expect(writes.daily).toBe(1)
  })

  // #2982: sessions are a newly read type; the `session` scope is already granted.
  it('reads a session event from the session path and writes it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.session))
    const out = await handleOuraWebhookEvent(deps(), event({ data_type: 'session', object_id: 'se-1' }))
    expect(out).toEqual({ result: 'written', counts: { ...NO_WRITES, sessions: 1 } })
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${OURA_API_BASE}/v2/usercollection/session/se-1`)
    expect(writes.sessions).toBe(1)
    expect(heartRate).not.toHaveBeenCalled()
  })

  it('reads vo2_max events from the vO2_max path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.vo2_max))
    await handleOuraWebhookEvent(deps(), event({ data_type: 'vo2_max', object_id: 'vo-1' }))
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${OURA_API_BASE}/v2/usercollection/vO2_max/vo-1`)
  })

  it('ignores a data type we do not store, without a lookup or a fetch', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ data_type: 'tag' }))).toMatchObject({ result: 'ignored' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #2974: Oura answers 401 for a type the user did not share; that is not a reason to reconnect.
  it('ignores an event for a type the grant does not cover, without a fetch', async () => {
    row = { ...row!, scope: 'extapi:personal extapi:daily extapi:heartrate extapi:workout' }
    expect(await handleOuraWebhookEvent(deps(), event({ data_type: 'daily_spo2', object_id: 'sp-1' })))
      .toEqual({ result: 'ignored', reason: 'daily_spo2 is not shared' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads any type when the grant has no scope string (a legacy row)', async () => {
    row = { ...row!, scope: null }
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_spo2))
    expect(await handleOuraWebhookEvent(deps(), event({ data_type: 'daily_spo2', object_id: 'sp-1' }))).toMatchObject({ result: 'written' })
  })

  it('does not start a heart-rate catch-up when heartrate is not shared', async () => {
    row = { ...row!, scope: 'extapi:daily' }
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.sleep))
    expect(await handleOuraWebhookEvent(deps(), event({ data_type: 'sleep', object_id: 'sl-1' }))).toMatchObject({ result: 'written' })
    expect(heartRate).not.toHaveBeenCalled()
  })

  it('answers unknown_user for an Oura account nobody here holds', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ user_id: 'someone-else' }))).toEqual({ result: 'unknown_user' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tombstones a deleted sleep period without calling Oura', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'sleep', object_id: 'sl-1' }))).toEqual({ result: 'deleted', tombstoned: 1 })
    expect(writes.tombstoned).toEqual(['sl-1'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a delete of a daily document', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete' }))).toMatchObject({ result: 'ignored' })
  })

  it('answers not_found when Oura no longer has the document or it is not the spec\'s shape', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'not_found' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'rd-1' }))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'not_found' })
    expect(writes.daily).toBe(0)
  })

  it('answers reauth on a refused token and forbidden on a 403, so Oura does not retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'reauth' })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'forbidden' })
  })

  it('throws OuraUnavailableError on a 429 or 5xx, so the route asks Oura to retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }))
    await expect(handleOuraWebhookEvent(deps(), event())).rejects.toBeInstanceOf(OuraUnavailableError)
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    await expect(handleOuraWebhookEvent(deps(), event())).rejects.toBeInstanceOf(OuraUnavailableError)
  })

  it('answers reauth when the refresh is refused', async () => {
    row = { ...row!, expiresAt: new Date(Date.now() - 1000) }
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'reauth' })
    expect(String(fetchMock.mock.calls[0][0])).toBe(OURA_TOKEN_URL)
  })

  // #2895 review, item 3: Oura has no heart-rate webhook, so these events start a catch-up.
  it('starts a heart-rate catch-up after a sleep, daily_activity or workout event, and only then', async () => {
    for (const [type, id] of [['sleep', 'sl-1'], ['daily_activity', 'da-1'], ['workout', 'wo-1']] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES[type]))
      expect(await handleOuraWebhookEvent(deps(), event({ data_type: type, object_id: id }))).toMatchObject({ result: 'written' })
    }
    expect(heartRate.mock.calls).toEqual([[USER], [USER], [USER]])
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_readiness))
    await handleOuraWebhookEvent(deps(), event())
    expect(heartRate).toHaveBeenCalledTimes(3)
  })
})

describe('catchUpOuraCloudHeartRate (#2895)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const savedKey = process.env.OURA_TOKEN_KEY
  const now = Date.parse('2026-10-14T02:00:00Z')
  let newest: Date | null
  let since: Date | null
  const upserts: { points: number; tz: string }[] = []
  const contexts: (string | null)[] = []
  /** What the fake upsert answers; `null` = every point it is given. */
  let written: number | null

  const deps = (timezone: string | null = 'Australia/Brisbane'): Pick<OuraWebhookDeps, 'repo' | 'config'> => ({
    config: CONFIG,
    repo: {
      getUserIdByOuraUserId: async () => USER,
      getOuraCloudTokens: async () => ({
        userId: USER,
        accessToken: encryptOuraToken('acc', USER, 'access_token'),
        refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
        expiresAt: new Date(Date.now() + 86_400_000), scope: 'heartrate', ouraUserId: OURA_USER, updatedAt: new Date(),
      }),
      saveOuraCloudTokens: async () => {},
      deleteOuraCloudTokens: async () => true,
      upsertOuraDaily: async () => {},
      upsertBodyMetrics: async () => {},
      upsertOuraCloudSleep: async () => ({ written: 0, skippedOverlap: 0 }),
      tombstoneOuraCloudSleep: async () => 0,
      upsertOuraWorkouts: async () => 0,
      upsertOuraCloudHeartrate: async (_u, rows, tz) => {
        upserts.push({ points: rows.length, tz }); contexts.push(...rows.map(r => r.context ?? null))
        return written ?? rows.length
      },
      upsertOuraCloudSleepPeriods: async () => 0,
      upsertOuraCloudDaily: async () => 0,
      upsertOuraSessions: async () => 0,
      getLatestOuraCloudHeartrateAt: async (_u, from) => { since = from; return newest },
      getUserById: async () => ({ id: USER, timezone }) as User,
    },
  })

  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    newest = null; since = null; upserts.length = 0; contexts.length = 0; written = null
    resetOuraCloudHeartRateThrottle()
    resetOuraCloudReportThrottle()
    reportServerError.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [
        { timestamp: '2026-10-14T01:00:00+00:00', bpm: 61, source: 'awake' },
        { timestamp: '2026-10-14T01:05:00+00:00', bpm: 400, source: 'awake' },
      ],
      next_token: null,
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    process.env.OURA_TOKEN_KEY = savedKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const reported = () => reportServerError.mock.calls.map(c => (c[0] as Error).message)

  it('reads from the newest oura_cloud point to now and writes in the user\'s timezone', async () => {
    newest = new Date('2026-10-13T22:30:00Z')
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/v2/usercollection/heartrate')
    expect(url.searchParams.get('start_datetime')).toBe('2026-10-13T22:30:00.000Z')
    expect(url.searchParams.get('end_datetime')).toBe('2026-10-14T02:00:00.000Z')
    expect(since?.getTime()).toBe(now - HEART_RATE_LOOKBACK_MS)
    // The implausible 400 bpm is dropped, not clamped.
    expect(upserts).toEqual([{ points: 1, tz: 'Australia/Brisbane' }])
  })

  it('reads at most a week back when there is no Cloud point yet, with the default timezone for a user without one', async () => {
    await catchUpOuraCloudHeartRate(deps(null), USER, now)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Date.parse(url.searchParams.get('start_datetime')!)).toBe(now - HEART_RATE_LOOKBACK_MS)
    expect(upserts[0].tz).toBe('Australia/Brisbane')
  })

  it('runs at most once per user in five minutes when one sync fans out into several events', async () => {
    startOuraCloudHeartRateCatchUp(deps(), USER, now)
    startOuraCloudHeartRateCatchUp(deps(), USER, now + 60_000)
    await vi.waitFor(() => expect(upserts).toHaveLength(1))
    startOuraCloudHeartRateCatchUp(deps(), USER, now + 6 * 60_000)
    await vi.waitFor(() => expect(upserts).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // #2982: no Oura heart rate had landed. A normal page must land rows, with Oura's labels kept.
  it('lands a normal heart-rate page, keeping each sample\'s label as its context, and reports nothing', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [
        { timestamp: '2026-10-14T00:00:00+00:00', timestamp_unix: 1791936000000, bpm: 58, source: 'rest' },
        { timestamp: '2026-10-14T00:05:00+00:00', timestamp_unix: 1791936300000, bpm: 54, source: 'sleep' },
        { timestamp: '2026-10-14T00:10:00+00:00', timestamp_unix: 1791936600000, bpm: 121, source: 'workout' },
      ],
      next_token: null,
    }))
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(3)
    expect(contexts).toEqual(['rest', 'sleep', 'workout'])
    expect(reportServerError).not.toHaveBeenCalled()
  })

  // #2982 evidence: Cloud points did land, so a partial loss to the cover filter must show as well.
  it('logs how many plausible points the device-row cover filter kept out', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [
        { timestamp: '2026-10-14T00:00:00+00:00', bpm: 58, source: 'rest' },
        { timestamp: '2026-10-14T00:05:00+00:00', bpm: 54, source: 'rest' },
      ],
      next_token: null,
    }))
    written = 1
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(1)
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/2 read, 2 plausible, 1 written, 1 covered by device rows$/))
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('keeps a reading whose label Oura added after the pinned spec, with no context', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [{ timestamp: '2026-10-14T00:00:00+00:00', timestamp_unix: 1791936000000, bpm: 58, source: 'nap' }],
      next_token: null,
    }))
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(1)
    expect(contexts).toEqual([null])
  })

  it('reports a refused heart-rate catch-up (401 or 403) instead of swallowing it', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 401 }))
    startOuraCloudHeartRateCatchUp(deps(), USER, now)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(1))
    expect(reported()[0]).toMatch(/webhook-heartrate:refused: the heart-rate read was refused: Oura answered 401/)

    resetOuraCloudHeartRateThrottle(); resetOuraCloudReportThrottle(); reportServerError.mockReset()
    fetchMock.mockImplementation(async () => new Response('', { status: 403 }))
    startOuraCloudHeartRateCatchUp(deps(), USER, now)
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalledTimes(1))
    expect(reported()[0]).toMatch(/Oura answered 403/)
    expect(upserts).toEqual([])
  })

  it('reports an empty answer over an hour or more, and not a short one', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [], next_token: null }))
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(0)
    expect(reported()).toEqual([expect.stringMatching(/webhook-heartrate:empty: Oura answered no heart rate for the last 168 h \(none stored this week\)/)])

    resetOuraCloudReportThrottle(); reportServerError.mockReset()
    newest = new Date(now - 10 * 60_000)
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(0)
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('reports rows that failed the spec\'s shape, and rows read but none written', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [{ timestamp: 'not a time', bpm: 60, source: 'awake' }, { timestamp: '2026-10-14T01:00:00+00:00', bpm: 61, source: 'awake' }],
      next_token: null,
    }))
    written = 0
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(0)
    expect(reported()).toEqual([
      expect.stringMatching(/webhook-heartrate:dropped: 1 of 2 rows did not match the spec/),
      expect.stringMatching(/webhook-heartrate:none-written: 1 rows read, 1 plausible, 0 written/),
    ])
    // Counts only: never a reading.
    expect(reported().join(' ')).not.toMatch(/\b61\b/)
  })
})
