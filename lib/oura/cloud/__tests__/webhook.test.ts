// The Oura webhook's signature check and event handling (#2859), with Oura mocked at `fetch`.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_API_BASE, OURA_TOKEN_URL, type OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { OuraUnavailableError } from '../client'
import { NO_WRITES } from '../ingest'
import { getOuraAccessToken, storeOuraGrant, type OuraTokenStore } from '../tokens'
import {
  catchUpOuraCloudHeartRate, catchUpOuraCloudRingBattery, handleOuraWebhookEvent, RING_BATTERY_OVERLAP_MS, resetOuraCloudRingBatteryThrottle, RING_BATTERY_MIN_INTERVAL_MS, RING_BATTERY_REFUSED_BACKOFF_MS, startOuraCloudRingBatteryCatchUp, HEART_RATE_LOOKBACK_MS, HEART_RATE_OVERLAP_MS, MAX_EVENT_AGE_MS, ouraWebhookConfig,
  resetOuraCloudHeartRateThrottle, startOuraCloudHeartRateCatchUp, verifyOuraSignature, type OuraWebhookDeps,
} from '../webhook'
import type { User } from '@trainingai/shared/types'
import { resetOuraCloudReportThrottle } from '../report'
import { OURA_DELETE_TYPES, type OuraDocumentType } from '../documents'
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
  const writes = { daily: 0, sleep: 0, sessions: 0, tombstoned: [] as string[], workoutsTombstoned: [] as string[], sessionsTombstoned: [] as string[] }
  const heartRate = vi.fn()
  const ringBattery = vi.fn()

  function deps(): OuraWebhookDeps {
    return {
      config: CONFIG,
      heartRate,
      ringBattery,
      repo: {
        getUserIdByOuraUserId: async id => (id === OURA_USER && row ? USER : null),
        getOuraCloudTokens: async id => (row && id === row.userId ? row : null),
        saveOuraCloudTokens: async (_u, input) => {
          row = { ...row!, ...input, reauthRequiredAt: null, updatedAt: new Date(row!.updatedAt.getTime() + 1) }
        },
        markOuraCloudReauthRequired: async (_u, since) => {
          if (!row || row.updatedAt.getTime() > since.getTime()) return false
          row = { ...row, reauthRequiredAt: row.reauthRequiredAt ?? new Date() }
          return true
        },
        deleteOuraCloudTokens: async () => true,
        upsertOuraDaily: async (_u, rows) => { writes.daily += rows.length },
        upsertBodyMetrics: async () => {},
        upsertOuraCloudSleep: async (_u, rows) => { writes.sleep += rows.length; return { written: rows.length, skippedOverlap: 0 } },
        tombstoneOuraCloudSleep: async (_u, ids) => { writes.tombstoned.push(...ids); return ids.length },
        syncOuraMainSleepBodyMetrics: async () => ({ written: 0, cleared: 0 }),
        upsertOuraWorkouts: async (_u, rows) => rows.length,
        tombstoneOuraWorkouts: async (_u, ids) => { writes.workoutsTombstoned.push(...ids); return ids.length },
        tombstoneOuraWorkoutsAbsent: async () => 0,
        upsertOuraCloudHeartrate: async (_u, rows) => ({ offered: rows.length, changed: rows.length, changedFrom: null, changedTo: null }),
        upsertOuraCloudSleepPeriods: async (_u, rows) => rows.length,
        upsertOuraCloudDaily: async (_u, rows) => rows.length,
        upsertOuraSessions: async (_u, rows) => { writes.sessions += rows.length; return rows.length },
        tombstoneOuraSessions: async (_u, ids) => { writes.sessionsTombstoned.push(...ids); return ids.length },
        tombstoneOuraSessionsAbsent: async () => 0,
        getLatestOuraCloudHeartrateAt: async () => null,
        getLatestOuraCloudBatteryAt: async () => null,
        insertOuraCloudBatteryReadings: async () => 0,
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
      ouraUserId: OURA_USER, updatedAt: new Date(), reauthRequiredAt: null,
    }
    writes.daily = 0; writes.sleep = 0; writes.sessions = 0; writes.tombstoned = []; writes.workoutsTombstoned = []; writes.sessionsTombstoned = []
    heartRate.mockReset()
    ringBattery.mockReset()
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

  // #3069: the ring's battery rides the same events as the heart rate, on its own scope.
  it('starts the ring-battery read only for a sync event on a grant that covers it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_activity))
    await handleOuraWebhookEvent(deps(), event({ data_type: 'daily_activity', object_id: 'da-1' }))
    expect(ringBattery.mock.calls).toEqual([[USER]])

    ringBattery.mockReset()
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_readiness))
    await handleOuraWebhookEvent(deps(), event())
    expect(ringBattery).not.toHaveBeenCalled()

    row = { ...row!, scope: 'extapi:personal extapi:heartrate extapi:workout' }
    fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.workout))
    await handleOuraWebhookEvent(deps(), event({ data_type: 'workout', object_id: 'wo-1' }))
    expect(ringBattery).not.toHaveBeenCalled()
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
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'sleep', object_id: 'sl-1' }))).toEqual({ result: 'deleted', rows: 1 })
    expect(writes.tombstoned).toEqual(['sl-1'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #3087: a workout deleted in the Oura app must stop counting in the energy budget.
  it('tombstones a deleted workout without calling Oura, and leaves sleep alone', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'workout', object_id: 'wo-1' }))).toEqual({ result: 'deleted', rows: 1 })
    expect(writes.workoutsTombstoned).toEqual(['wo-1'])
    expect(writes.tombstoned).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a workout delete for an Oura account nobody here holds tombstones nothing', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'workout', object_id: 'wo-1', user_id: 'someone-else' }))).toEqual({ result: 'unknown_user' })
    expect(writes.workoutsTombstoned).toEqual([])
  })

  // #3153: a session deleted in the Oura app leaves the day timeline.
  it('tombstones a deleted session without calling Oura, and leaves sleep and workouts alone', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'session', object_id: 'se-1' }))).toEqual({ result: 'deleted', rows: 1 })
    expect(writes.sessionsTombstoned).toEqual(['se-1'])
    expect(writes.tombstoned).toEqual([])
    expect(writes.workoutsTombstoned).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a session delete for an Oura account nobody here holds tombstones nothing', async () => {
    expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'session', object_id: 'se-1', user_id: 'someone-else' }))).toEqual({ result: 'unknown_user' })
    expect(writes.sessionsTombstoned).toEqual([])
  })

  // #3155 review: a delete only ever tombstones. Daily documents need a stored id first (#3153), so
  // until then nothing is removed.
  it('ignores a delete of a type it does not act on yet (daily documents until #3153)', async () => {
    for (const data_type of ['daily_readiness', 'daily_activity']) {
      expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type }))).toMatchObject({ result: 'ignored' })
    }
    expect(writes.tombstoned).toEqual([])
    expect(writes.workoutsTombstoned).toEqual([])
    expect(writes.sessionsTombstoned).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // #3153 review: a type listed in OURA_DELETE_TYPES with no branch of its own must never reach the
  // sleep tombstone with an id that names something else; it is ignored and reported.
  it('ignores and reports a tracked delete type that has no tombstone branch', async () => {
    resetOuraCloudReportThrottle()
    reportServerError.mockReset()
    const types = OURA_DELETE_TYPES as OuraDocumentType[]
    types.push('daily_readiness')
    try {
      expect(await handleOuraWebhookEvent(deps(), event({ event_type: 'delete', data_type: 'daily_readiness', object_id: 'rd-1' })))
        .toMatchObject({ result: 'ignored' })
    } finally {
      types.splice(types.indexOf('daily_readiness'), 1)
    }
    expect(writes.tombstoned).toEqual([])
    expect(writes.workoutsTombstoned).toEqual([])
    expect(writes.sessionsTombstoned).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(reportServerError).toHaveBeenCalled())
    expect((reportServerError.mock.calls[0][0] as Error).message).toMatch(/webhook-delete:unhandled-daily_readiness/)
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

  /** Answers by URL: the document read, `personal_info` (by the token sent) and the token endpoint. */
  function oura(answers: { doc: () => Response; personalInfo: (token: string) => Response; refresh?: () => Response }) {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === OURA_TOKEN_URL) return answers.refresh?.() ?? jsonResponse({ error: 'invalid_grant' }, 400)
      if (url.endsWith('/personal_info')) {
        const auth = new Headers(init?.headers).get('Authorization') ?? ''
        return answers.personalInfo(auth.replace(/^Bearer /, ''))
      }
      return answers.doc()
    })
  }
  const refused = () => new Response('', { status: 401 })

  it('answers forbidden on a 403, so Oura does not retry, and records nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'forbidden' })
    expect(row!.reauthRequiredAt).toBeNull()
  })

  // #3204: a 401 alone does not prove the grant is gone; the scope-free personal_info read decides.
  it('records the grant as refused when the token, and the refresh, are refused', async () => {
    oura({ doc: refused, personalInfo: refused })
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'reauth' })
    expect(row!.reauthRequiredAt).toBeInstanceOf(Date)
    // Once recorded, the grant is not sent to Oura again.
    fetchMock.mockClear()
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'reauth' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('records the grant as refused when a freshly refreshed token is refused too', async () => {
    oura({
      doc: refused, personalInfo: refused,
      refresh: () => jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }),
    })
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'reauth' })
    expect(row!.reauthRequiredAt).toBeInstanceOf(Date)
  })

  it('records nothing when the token works on personal_info: the type was refused, not the grant', async () => {
    oura({ doc: refused, personalInfo: () => jsonResponse({ id: OURA_USER }) })
    expect(await handleOuraWebhookEvent(deps(), event())).toEqual({ result: 'forbidden' })
    expect(row!.reauthRequiredAt).toBeNull()
    expect(fetchMock.mock.calls.some(c => String(c[0]) === OURA_TOKEN_URL)).toBe(false)
  })

  it('asks Oura to retry, and records nothing, when a refresh brings a token that works', async () => {
    oura({
      doc: refused,
      personalInfo: token => (token === 'acc-2' ? jsonResponse({ id: OURA_USER }) : refused()),
      refresh: () => jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }),
    })
    await expect(handleOuraWebhookEvent(deps(), event())).rejects.toBeInstanceOf(OuraUnavailableError)
    expect(row!.reauthRequiredAt).toBeNull()
  })

  it('records nothing when Oura cannot be reached to check the refusal', async () => {
    oura({ doc: refused, personalInfo: () => new Response('', { status: 503 }) })
    await expect(handleOuraWebhookEvent(deps(), event())).rejects.toBeInstanceOf(OuraUnavailableError)
    expect(row!.reauthRequiredAt).toBeNull()
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
    expect(row!.reauthRequiredAt).toBeInstanceOf(Date) // #3204
  })

  // #2895 review, item 3: Oura has no heart-rate webhook, so these events start a catch-up.
  it('starts a heart-rate catch-up after a sleep, daily_activity or workout event, and only then', async () => {
    for (const [type, id] of [['sleep', 'sl-1'], ['daily_activity', 'da-1'], ['workout', 'wo-1']] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES[type]))
      expect(await handleOuraWebhookEvent(deps(), event({ data_type: type, object_id: id }))).toMatchObject({ result: 'written' })
    }
    expect(heartRate.mock.calls).toEqual([[USER], [USER], [USER]])
    expect(ringBattery.mock.calls).toEqual([[USER], [USER], [USER]])
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
  /** How many of those it reports as new or changed; `null` = all of them. */
  let changed: number | null

  const deps = (timezone: string | null = 'Australia/Brisbane'): Pick<OuraWebhookDeps, 'repo' | 'config'> => ({
    config: CONFIG,
    repo: {
      getUserIdByOuraUserId: async () => USER,
      getOuraCloudTokens: async () => ({
        userId: USER,
        accessToken: encryptOuraToken('acc', USER, 'access_token'),
        refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
        expiresAt: new Date(Date.now() + 86_400_000), scope: 'heartrate', ouraUserId: OURA_USER, updatedAt: new Date(), reauthRequiredAt: null,
      }),
      saveOuraCloudTokens: async () => {},
        markOuraCloudReauthRequired: async () => true,
      deleteOuraCloudTokens: async () => true,
      upsertOuraDaily: async () => {},
      upsertBodyMetrics: async () => {},
      upsertOuraCloudSleep: async () => ({ written: 0, skippedOverlap: 0 }),
      tombstoneOuraCloudSleep: async () => 0,
      syncOuraMainSleepBodyMetrics: async () => ({ written: 0, cleared: 0 }),
      upsertOuraWorkouts: async () => 0,
      tombstoneOuraWorkouts: async () => 0,
      tombstoneOuraWorkoutsAbsent: async () => 0,
      upsertOuraCloudHeartrate: async (_u, rows, tz) => {
        upserts.push({ points: rows.length, tz }); contexts.push(...rows.map(r => r.context ?? null))
        const n = written ?? rows.length
        const times = rows.map(r => r.timestamp.getTime()).sort((a, b) => a - b)
        return { offered: n, changed: changed ?? n, changedFrom: (changed ?? n) > 0 ? new Date(times[0]) : null, changedTo: (changed ?? n) > 0 ? new Date(times[times.length - 1]) : null }
      },
      upsertOuraCloudSleepPeriods: async () => 0,
      upsertOuraCloudDaily: async () => 0,
      upsertOuraSessions: async () => 0,
      tombstoneOuraSessions: async () => 0,
      tombstoneOuraSessionsAbsent: async () => 0,
      getLatestOuraCloudHeartrateAt: async (_u, from) => { since = from; return newest },
      getLatestOuraCloudBatteryAt: async () => null,
      insertOuraCloudBatteryReadings: async () => 0,
      getUserById: async () => ({ id: USER, timezone }) as User,
    },
  })

  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    newest = null; since = null; upserts.length = 0; contexts.length = 0; written = null; changed = null
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

  it('reads from 6 h behind the newest oura_cloud point to now and writes in the user\'s timezone', async () => {
    newest = new Date('2026-10-13T22:30:00Z')
    expect(await catchUpOuraCloudHeartRate(deps(), USER, now)).toBe(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/v2/usercollection/heartrate')
    // #3078: a batch Oura stamps earlier than a stored point is still read.
    expect(url.searchParams.get('start_datetime')).toBe(new Date(newest.getTime() - HEART_RATE_OVERLAP_MS).toISOString())
    expect(url.searchParams.get('start_datetime')).toBe('2026-10-13T16:30:00.000Z')
    expect(url.searchParams.get('end_datetime')).toBe('2026-10-14T02:00:00.000Z')
    expect(since?.getTime()).toBe(now - HEART_RATE_LOOKBACK_MS)
    // The implausible 400 bpm is dropped, not clamped.
    expect(upserts).toEqual([{ points: 1, tz: 'Australia/Brisbane' }])
  })

  it('never reads past the week floor, however old the newest point', async () => {
    newest = new Date(now - HEART_RATE_LOOKBACK_MS + 60 * 60_000)
    await catchUpOuraCloudHeartRate(deps(), USER, now)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Date.parse(url.searchParams.get('start_datetime')!)).toBe(now - HEART_RATE_LOOKBACK_MS)
  })

  // #3078: the workouts the written points overlap are re-attributed, once, over the points' span.
  it('re-attributes workouts over the changed points\' span, and only when points changed', async () => {
    const calls: [string, string, string, string][] = []
    const workoutHr = async (u: string, f: Date, t: Date, tz: string) => { calls.push([u, f.toISOString(), t.toISOString(), tz]); return 1 }
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [
        { timestamp: '2026-10-14T00:10:00+00:00', bpm: 121, source: 'workout' },
        { timestamp: '2026-10-14T00:00:00+00:00', bpm: 58, source: 'rest' },
      ],
      next_token: null,
    }))
    expect(await catchUpOuraCloudHeartRate({ ...deps(), workoutHr }, USER, now)).toBe(2)
    expect(calls).toEqual([[USER, '2026-10-14T00:00:00.000Z', '2026-10-14T00:10:00.000Z', 'Australia/Brisbane']])

    // A re-read that changes nothing re-attributes nothing.
    changed = 0
    expect(await catchUpOuraCloudHeartRate({ ...deps(), workoutHr }, USER, now)).toBe(2)
    expect(calls).toHaveLength(1)
  })

  it('a failed re-attribution is reported and does not fail the heart-rate read', async () => {
    const workoutHr = async () => { throw new Error('pool timeout') }
    expect(await catchUpOuraCloudHeartRate({ ...deps(), workoutHr }, USER, now)).toBe(1)
    await vi.waitFor(() => expect(reported()).toEqual([expect.stringMatching(/webhook-heartrate:workouts: pool timeout/)]))
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
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/2 read, 2 plausible, 1 written \(1 new or changed\), 1 covered by device rows$/))
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
    fetchMock.mockImplementation(async input => String(input) === OURA_TOKEN_URL
      ? jsonResponse({ error: 'invalid_grant' }, 400)
      : new Response('', { status: 401 }))
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

describe('catchUpOuraCloudRingBattery (#3069)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const savedKey = process.env.OURA_TOKEN_KEY
  const now = Date.parse('2026-10-14T02:00:00Z')
  let newest: Date | null
  let tokenExpiresAt: Date | null = null
  const stored: { measuredAt: Date; percent: number; charging: boolean | null }[] = []

  const deps = (): Pick<OuraWebhookDeps, 'repo' | 'config'> => ({
    config: CONFIG,
    repo: {
      getOuraCloudTokens: async () => ({
        userId: USER,
        accessToken: encryptOuraToken('acc', USER, 'access_token'),
        refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
        expiresAt: tokenExpiresAt ?? new Date(Date.now() + 86_400_000), scope: 'extapi:daily', ouraUserId: OURA_USER, updatedAt: new Date(), reauthRequiredAt: null,
      }),
      saveOuraCloudTokens: async () => {},
      markOuraCloudReauthRequired: async () => true,
      deleteOuraCloudTokens: async () => true,
      getLatestOuraCloudBatteryAt: async () => newest,
      insertOuraCloudBatteryReadings: async (_u: string, rows: typeof stored) => { stored.push(...rows); return rows.length },
    } as unknown as OuraWebhookDeps['repo'],
  })

  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    newest = null; tokenExpiresAt = null; stored.length = 0
    resetOuraCloudRingBatteryThrottle()
    resetOuraCloudReportThrottle()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse({
      data: [
        { timestamp: '2026-10-14T01:00:00+00:00', timestamp_unix: 1, level: 64, charging: false, in_charger: false },
        { timestamp: '2026-10-14T01:15:00+00:00', timestamp_unix: 2, level: 66, charging: null, in_charger: true },
        { timestamp: '2026-10-14T01:30:00+00:00', timestamp_unix: 3, level: 140, charging: false, in_charger: false },
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

  it('reads ring_battery_level from 6 h behind the newest stored reading and stores what matches the spec', async () => {
    newest = new Date('2026-10-13T22:30:00Z')
    expect(await catchUpOuraCloudRingBattery(deps(), USER, now)).toBe(2)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/v2/usercollection/ring_battery_level')
    expect(url.searchParams.get('start_datetime')).toBe(new Date(newest.getTime() - RING_BATTERY_OVERLAP_MS).toISOString())
    expect(url.searchParams.get('end_datetime')).toBe('2026-10-14T02:00:00.000Z')
    // A level of 140 is outside the spec's [0, 100] and is dropped; in_charger counts as charging.
    expect(stored.map(r => [r.percent, r.charging])).toEqual([[64, false], [66, true]])
  })

  it('throttles the background start to once per interval per user', async () => {
    startOuraCloudRingBatteryCatchUp(deps(), USER, now)
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + 60_000)
    await vi.waitFor(() => expect(stored.length).toBe(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not throw when Oura refuses the read: the background start swallows it', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
    expect(() => startOuraCloudRingBatteryCatchUp(deps(), USER, now)).not.toThrow()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(stored).toEqual([])
  })

  it('does not ask again for a day after a refusal, then tries once more', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
    startOuraCloudRingBatteryCatchUp(deps(), USER, now)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())

    // Past the five-minute throttle, inside the day: skipped without a request.
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + 2 * RING_BATTERY_MIN_INTERVAL_MS)
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + RING_BATTERY_REFUSED_BACKOFF_MS - 1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    startOuraCloudRingBatteryCatchUp(deps(), USER, now + RING_BATTERY_REFUSED_BACKOFF_MS)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('backs off after a 401 too', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }))
    startOuraCloudRingBatteryCatchUp(deps(), USER, now)
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    const calls = fetchMock.mock.calls.length
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + 2 * RING_BATTERY_MIN_INTERVAL_MS)
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + RING_BATTERY_REFUSED_BACKOFF_MS - 1)
    // The catch-up fetches asynchronously, so give a request that should not happen time to happen;
    // checked straight away, this passed even with the 401 back-off removed.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(fetchMock.mock.calls.length).toBe(calls)

    fetchMock.mockClear()
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + RING_BATTERY_REFUSED_BACKOFF_MS)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })

  describe('a renewed connection clears the back-off', () => {
    const refuse = async () => {
      fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
      startOuraCloudRingBatteryCatchUp(deps(), USER, now)
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
      fetchMock.mockClear()
      fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
      // Inside the day and past the throttle: held back.
      startOuraCloudRingBatteryCatchUp(deps(), USER, now + 2 * RING_BATTERY_MIN_INTERVAL_MS)
      expect(fetchMock).not.toHaveBeenCalled()
    }

    it('connecting Oura again', async () => {
      await refuse()
      const store = { ...deps().repo, saveOuraCloudTokens: async () => {} } as unknown as OuraTokenStore
      await storeOuraGrant(store, USER, { accessToken: 'acc-3', refreshToken: 'ref-3', expiresAt: new Date(now + 86_400_000), scope: 'extapi:daily', ouraUserId: OURA_USER }, () => {})
      startOuraCloudRingBatteryCatchUp(deps(), USER, now + 3 * RING_BATTERY_MIN_INTERVAL_MS)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    })

    it('refreshing the token', async () => {
      await refuse()
      tokenExpiresAt = new Date(Date.now() - 1000)
      fetchMock.mockImplementation(async () => jsonResponse({ access_token: 'acc-2', refresh_token: 'ref-2', expires_in: 86400 }))
      expect(await getOuraAccessToken(deps().repo, CONFIG, USER)).toBe('acc-2')
      tokenExpiresAt = null // the stored token is fresh now
      fetchMock.mockClear()
      fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }))
      startOuraCloudRingBatteryCatchUp(deps(), USER, now + 3 * RING_BATTERY_MIN_INTERVAL_MS)
      await vi.waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('ring_battery_level'))).toBe(true))
    })

    it('a user whose connection did not change stays backed off', async () => {
      await refuse()
      const store = { ...deps().repo, saveOuraCloudTokens: async () => {} } as unknown as OuraTokenStore
      await storeOuraGrant(store, 'someone-else', { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(now + 86_400_000), scope: null, ouraUserId: 'x' }, () => {})
      startOuraCloudRingBatteryCatchUp(deps(), USER, now + 3 * RING_BATTERY_MIN_INTERVAL_MS)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('a failure that is not a refusal is not held back for a day', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    startOuraCloudRingBatteryCatchUp(deps(), USER, now)
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1))
    const before = fetchMock.mock.calls.length
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    startOuraCloudRingBatteryCatchUp(deps(), USER, now + 2 * RING_BATTERY_MIN_INTERVAL_MS)
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before))
  })
})
