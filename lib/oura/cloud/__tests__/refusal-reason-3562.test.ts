// #3562: why Oura refused a read (401 / 403) is kept, short and safe, and reaches the backfill report
// and `error_events`. Oura is mocked at `fetch`; no real Oura call is made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import type { OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { backfillOuraCloud, listRefusedTypes, reportBackfillGaps, type OuraBackfillDeps } from '../backfill'
import {
  describeRefusal, fetchOuraDocuments, MAX_REFUSAL_REASON, OuraForbiddenError, OuraUnauthorizedError,
} from '../data'
import { resetOuraCloudReportThrottle } from '../report'
import { resetOuraCloudRingBatteryThrottle, startOuraCloudRingBatteryCatchUp, type OuraWebhookDeps } from '../webhook'
import { jsonResponse } from './fixtures'

const reportServerError = vi.fn()
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

const USER = '11111111-1111-4111-8111-111111111111'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://localhost:3000/api/oura/callback' }
const TOKEN = 'tok-SECRET-abc123.def456'
const fetchMock = vi.fn<typeof fetch>()

const reported = () => reportServerError.mock.calls.map(c => (c[0] as Error).message)

async function refusal<T extends Error>(run: () => Promise<unknown>): Promise<T> {
  try { await run() } catch (e) { return e as T }
  throw new Error('expected a refusal')
}
const read = () => fetchOuraDocuments(TOKEN, 'daily_stress', '2026-10-01', '2026-10-02')

beforeEach(() => {
  process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
  fetchMock.mockReset()
  reportServerError.mockReset()
  resetOuraCloudReportThrottle()
  resetOuraCloudRingBatteryThrottle()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the reason on a 401 or 403 (#3562)', () => {
  it('reads error and scope from WWW-Authenticate', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="x"' } }))
    const err = await refusal<OuraUnauthorizedError>(read)
    expect(err).toBeInstanceOf(OuraUnauthorizedError)
    expect(err.reason).toBe('insufficient_scope, scope="x"')
    expect(describeRefusal(401, err.reason)).toBe('401: insufficient_scope, scope="x"')
    expect(err.message).toBe('Oura refused the access token')
  })

  it('reads detail from a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Token lacks the heart_health scope' }, 401))
    expect((await refusal<OuraUnauthorizedError>(read)).reason).toBe('Token lacks the heart_health scope')
  })

  it('falls back to message, then error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'no scope', error: 'e' }, 401))
    expect((await refusal<OuraUnauthorizedError>(read)).reason).toBe('no scope')
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_token' }, 401))
    expect((await refusal<OuraUnauthorizedError>(read)).reason).toBe('invalid_token')
  })

  it('has no reason, and an unchanged message, when Oura says nothing usable', async () => {
    for (const body of ['', 'not json', '{"detail":42}']) {
      fetchMock.mockResolvedValue(new Response(body, { status: 401 }))
      const err = await refusal<OuraUnauthorizedError>(read)
      expect(err.reason).toBeUndefined()
      expect(err.message).toBe('Oura refused the access token')
    }
    expect(describeRefusal(401)).toBe('401')
  })

  it('keeps the reason from a 403 body, and its message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Membership expired' }, 403))
    const err = await refusal<OuraForbiddenError>(read)
    expect(err).toBeInstanceOf(OuraForbiddenError)
    expect(err.reason).toBe('Membership expired')
    expect(err.message).toBe('Oura refused access to daily_stress (403)')
  })

  it('caps the reason and keeps printable ASCII only', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: `${'a'.repeat(500)}` }, 401))
    expect((await refusal<OuraUnauthorizedError>(read)).reason).toHaveLength(MAX_REFUSAL_REASON)
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'café\u0000 ‮ line\nbreak \u{1F600}' }, 401))
    const reason = (await refusal<OuraUnauthorizedError>(read)).reason!
    expect(reason).toMatch(/^[\x20-\x7e]+$/)
    expect(reason).toBe('caf line break')
  })

  it('never carries the bearer token, however the body echoes it', async () => {
    const echoes = [
      `Bearer ${TOKEN} refused`,
      `bad token ${TOKEN}`,
      `${encodeURIComponent(TOKEN)}`,
      `${TOKEN.slice(0, 8)}é${TOKEN.slice(8)}`, // split by a character the ASCII filter drops
      `${'x'.repeat(190)}${TOKEN}`, // straddles the cap
    ]
    for (const detail of echoes) {
      fetchMock.mockImplementation(async (_u, init) => {
        const sent = (init?.headers as Record<string, string>).Authorization
        return new Response(JSON.stringify({ detail: `${detail} ${sent}` }), {
          status: 401, headers: { 'WWW-Authenticate': `Bearer error="${TOKEN}", scope="${TOKEN}"` },
        })
      })
      const err = await refusal<OuraUnauthorizedError>(read)
      expect(err.reason).toBeDefined()
      expect(err.reason).not.toContain(TOKEN)
      expect(err.reason).not.toContain(TOKEN.slice(0, 12))
      expect(err.reason).not.toContain('Authorization')
    }
  })

  it('never carries the request query', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ detail: 'refused' }, 401))
    const err = await refusal<OuraUnauthorizedError>(read)
    expect(err.reason).toBe('refused')
  })
})

describe('the reason in the backfill report (#3562)', () => {
  const FULL_SCOPE = 'extapi:personal extapi:daily extapi:heartrate extapi:workout extapi:session extapi:spo2 extapi:heart_health'
  function repo(): OuraBackfillDeps['repo'] {
    const row: OuraCloudTokenRow = {
      userId: USER, accessToken: encryptOuraToken('acc', USER, 'access_token'), refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: FULL_SCOPE, ouraUserId: 'o', updatedAt: new Date(), reauthRequiredAt: null, lastWebhookAt: null, lastDataAt: null,
    }
    return {
      getOuraCloudTokens: async () => row, saveOuraCloudTokens: async () => {}, markOuraCloudReauthRequired: async () => true,
      touchOuraCloudData: async () => {}, getLatestOuraCloudBatteryAt: async () => null, insertOuraCloudBatteryReadings: async () => 0,
    } as unknown as OuraBackfillDeps['repo']
  }
  const OPTS = { from: '2026-10-01', to: '2026-10-03', heartRate: false, ringBattery: true, dryRun: true, tz: 'Australia/Brisbane' }

  it('names why Oura refused a granted type, and why it refused with a 403', async () => {
    fetchMock.mockImplementation(async input => {
      const path = new URL(String(input)).pathname.replace('/v2/usercollection/', '')
      if (path === 'ring_battery_level') return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="ring"' } })
      if (path === 'daily_spo2') return jsonResponse({ detail: 'Not shared' }, 403)
      if (path === 'personal_info') return jsonResponse({ id: 'o' })
      return jsonResponse({ data: [], next_token: null })
    })
    const out = await backfillOuraCloud({ repo: repo(), config: CONFIG }, USER, OPTS)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.report.refusedDespiteGrant).toEqual(['ring_battery'])
    expect(out.report.forbidden).toEqual(['daily_spo2'])
    expect(out.report.refusalReasons).toEqual({
      ring_battery: '401: insufficient_scope, scope="ring"',
      daily_spo2: '403: Not shared',
    })
    expect(listRefusedTypes(out.report.refusedDespiteGrant, out.report.refusalReasons)).toBe('ring_battery (401: insufficient_scope, scope="ring")')

    reportBackfillGaps(USER, out.report)
    await vi.waitFor(() => expect(reported()).toHaveLength(1))
    expect(reported()[0]).toBe('oura_cloud connect-backfill:forbidden: Oura refused daily_spo2 (403: Not shared)')
  })

  it('leaves the report and its messages as they were when Oura gives no reason', async () => {
    fetchMock.mockImplementation(async input => {
      const path = new URL(String(input)).pathname.replace('/v2/usercollection/', '')
      if (path === 'daily_spo2') return new Response('', { status: 403 })
      return jsonResponse({ data: [], next_token: null })
    })
    const out = await backfillOuraCloud({ repo: repo(), config: CONFIG }, USER, OPTS)
    if (!out.ok) throw new Error('backfill did not run')
    expect(out.report.refusalReasons).toBeUndefined()
    reportBackfillGaps(USER, out.report)
    await vi.waitFor(() => expect(reported()).toHaveLength(1))
    expect(reported()[0]).toBe('oura_cloud connect-backfill:forbidden: Oura refused daily_spo2 (403)')
  })
})

describe('the reason in the webhook refusal report (#3562)', () => {
  const deps = (): Pick<OuraWebhookDeps, 'repo' | 'config'> => ({
    config: CONFIG,
    repo: {
      getOuraCloudTokens: async () => ({
        userId: USER, accessToken: encryptOuraToken('acc', USER, 'access_token'), refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
        expiresAt: new Date(Date.now() + 86_400_000), scope: 'extapi:daily', ouraUserId: 'o', updatedAt: new Date(), reauthRequiredAt: null,
      }),
      saveOuraCloudTokens: async () => {}, markOuraCloudReauthRequired: async () => true, deleteOuraCloudTokens: async () => true,
      getLatestOuraCloudBatteryAt: async () => null, insertOuraCloudBatteryReadings: async () => 0,
    } as unknown as OuraWebhookDeps['repo'],
  })

  it('puts Oura\'s reason in the ring-battery report, and the old message when there is none', async () => {
    fetchMock.mockImplementation(async input => String(input).includes('personal_info')
      ? jsonResponse({ id: 'o' })
      : new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope", scope="daily heartrate"' } }))
    startOuraCloudRingBatteryCatchUp(deps(), USER)
    await vi.waitFor(() => expect(reported()).toHaveLength(1))
    expect(reported()[0]).toBe('oura_cloud webhook-ring-battery:refused: the ring-battery read was refused: Oura answered 401: insufficient_scope, scope="daily heartrate"')

    resetOuraCloudRingBatteryThrottle(); resetOuraCloudReportThrottle(); reportServerError.mockReset()
    fetchMock.mockImplementation(async input => String(input).includes('personal_info') ? jsonResponse({ id: 'o' }) : new Response('', { status: 403 }))
    startOuraCloudRingBatteryCatchUp(deps(), USER)
    await vi.waitFor(() => expect(reported()).toHaveLength(1))
    expect(reported()[0]).toBe('oura_cloud webhook-ring-battery:refused: the ring-battery read was refused: Oura answered 403')
  })
})
