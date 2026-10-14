// The Oura webhook's signature check and event handling (#2859), with Oura mocked at `fetch`.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { OURA_API_BASE, OURA_TOKEN_URL, type OuraOAuthConfig } from '../config'
import { encryptOuraToken } from '../token-cipher'
import { OuraUnavailableError } from '../client'
import { NO_WRITES } from '../ingest'
import {
  handleOuraWebhookEvent, MAX_EVENT_AGE_MS, ouraWebhookConfig, verifyOuraSignature, type OuraWebhookDeps,
} from '../webhook'
import { FIXTURES, jsonResponse, OURA_USER } from './fixtures'

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
    const env = { OURA_WEBHOOK_CALLBACK_URL: 'https://x.example/api/oura/webhook', OURA_WEBHOOK_VERIFICATION_TOKEN: 'vt' }
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
  const writes = { daily: 0, sleep: 0, tombstoned: [] as string[] }

  function deps(): OuraWebhookDeps {
    return {
      config: CONFIG,
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
      },
    }
  }

  beforeEach(() => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    row = {
      userId: USER,
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'daily', ouraUserId: OURA_USER, updatedAt: new Date(),
    }
    writes.daily = 0; writes.sleep = 0; writes.tombstoned = []
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
    expect(out).toEqual({ result: 'written', counts: { ...NO_WRITES, dailyRows: 1 } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${OURA_API_BASE}/v2/usercollection/daily_readiness/rd-1`)
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer acc')
    expect(writes.daily).toBe(1)
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
})
