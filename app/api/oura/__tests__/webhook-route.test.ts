// The Oura webhook route (#2859): verification challenge, signature gate, and the answers Oura's
// retry logic depends on. Oura is mocked at `fetch`; the repository is a fake.
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { OuraCloudTokenRow } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'
import { FIXTURES, jsonResponse, OURA_USER } from '@/lib/oura/cloud/__tests__/fixtures'

const USER = '11111111-1111-4111-8111-111111111111'
const ORIGIN = 'http://localhost:3000'
const rateLimit = vi.fn(() => true)
const reportServerError = vi.fn()
let row: OuraCloudTokenRow | null = null
const written: string[] = []
const repo = {
  getUserIdByOuraUserId: vi.fn(async (id: string) => (id === OURA_USER && row ? USER : null)),
  getOuraCloudTokens: vi.fn(async (id: string) => (row?.userId === id ? row : null)),
  saveOuraCloudTokens: vi.fn(async () => {}),
  deleteOuraCloudTokens: vi.fn(async () => true),
  upsertOuraDaily: vi.fn(async (_u: string, rows: { date: string }[]) => { written.push(...rows.map(r => `daily:${r.date}`)) }),
  upsertBodyMetrics: vi.fn(async () => {}),
  upsertOuraCloudSleep: vi.fn(async () => ({ written: 0, skippedOverlap: 0 })),
  tombstoneOuraCloudSleep: vi.fn(async (_u: string, ids: string[]) => ids.length),
  upsertOuraWorkouts: vi.fn(async () => 0),
  upsertOuraCloudHeartrate: vi.fn(async () => 0),
}

vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...args: unknown[]) => rateLimit(...(args as [])) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET, POST } from '../webhook/route'

const ENV = {
  OURA_CLIENT_ID: 'cid',
  OURA_CLIENT_SECRET: 'csecret',
  OURA_REDIRECT_URI: `${ORIGIN}/api/oura/callback`,
  OURA_TOKEN_KEY: 'k'.repeat(48),
  OURA_WEBHOOK_CALLBACK_URL: `${ORIGIN}/api/oura/webhook`,
  OURA_WEBHOOK_VERIFICATION_TOKEN: 'verify-me',
}
const fetchMock = vi.fn<typeof fetch>()

function verifyReq(params: Record<string, string>) {
  return new NextRequest(`${ORIGIN}/api/oura/webhook?${new URLSearchParams(params)}`)
}

function eventReq(body: unknown, opts: { secret?: string; timestamp?: string; signature?: string | null } = {}) {
  const text = JSON.stringify(body)
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000))
  const signature = opts.signature === undefined
    ? createHmac('sha256', opts.secret ?? 'csecret').update(timestamp + text).digest('hex').toUpperCase()
    : opts.signature
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-oura-timestamp': timestamp }
  if (signature !== null) headers['x-oura-signature'] = signature
  return new NextRequest(`${ORIGIN}/api/oura/webhook`, { method: 'POST', headers, body: text })
}

const EVENT = { event_type: 'update', data_type: 'daily_readiness', object_id: 'rd-1', event_time: '2026-10-14T02:00:00+00:00', user_id: OURA_USER }

describe('/api/oura/webhook (#2859)', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    vi.clearAllMocks()
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v }
    row = {
      userId: USER,
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'daily', ouraUserId: OURA_USER, updatedAt: new Date(),
    }
    written.length = 0
    rateLimit.mockReturnValue(true)
    reportServerError.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) process.env[k] = v
    vi.unstubAllGlobals()
  })

  describe('GET: the verification challenge', () => {
    it('echoes the challenge as JSON when the token is ours', async () => {
      const res = await GET(verifyReq({ verification_token: 'verify-me', challenge: 'abc123' }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ challenge: 'abc123' })
    })
    it('answers 401 for any other token', async () => {
      const res = await GET(verifyReq({ verification_token: 'guess', challenge: 'abc123' }))
      expect(res.status).toBe(401)
      expect(JSON.stringify(await res.json())).not.toContain('abc123')
    })
    it('answers 400 without a challenge or with unknown parameters', async () => {
      expect((await GET(verifyReq({ verification_token: 'verify-me' }))).status).toBe(400)
      expect((await GET(verifyReq({ verification_token: 'verify-me', challenge: 'c', extra: '1' }))).status).toBe(400)
    })
    it('answers 503 when the webhook is not configured, and checks nothing', async () => {
      delete process.env.OURA_WEBHOOK_VERIFICATION_TOKEN
      expect((await GET(verifyReq({ verification_token: 'verify-me', challenge: 'c' }))).status).toBe(503)
    })
  })

  describe('POST: an event', () => {
    it('writes the named document for a signed event', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_readiness))
      const res = await POST(eventReq(EVENT))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: true, result: 'written' })
      expect(written).toEqual(['daily:2026-10-10'])
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    })

    it('refuses an unsigned, mis-signed or stale event before any lookup', async () => {
      for (const req of [
        eventReq(EVENT, { signature: null }),
        eventReq(EVENT, { secret: 'not-the-secret' }),
        eventReq(EVENT, { timestamp: String(Math.floor(Date.now() / 1000) - 3 * 3600) }),
      ]) {
        const res = await POST(req)
        expect(res.status).toBe(401)
      }
      expect(repo.getUserIdByOuraUserId).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers 400 for a signed body that is not the spec\'s event', async () => {
      const res = await POST(eventReq({ event_type: 'explode', data_type: 'sleep', object_id: 'x', user_id: OURA_USER }))
      expect(res.status).toBe(400)
    })

    it('answers 413 for an oversized body', async () => {
      const res = await POST(eventReq({ ...EVENT, padding: 'x'.repeat(10_000) }))
      expect(res.status).toBe(413)
    })

    it('answers 200 for an Oura account nobody here holds, so Oura stops retrying, and never 410', async () => {
      const res = await POST(eventReq({ ...EVENT, user_id: 'stranger' }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: true, result: 'unknown_user' })
    })

    it('answers 503 when Oura is unavailable, so Oura retries', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }))
      const res = await POST(eventReq(EVENT))
      expect(res.status).toBe(503)
      expect(reportServerError).not.toHaveBeenCalled()
    })

    it('answers 503 and records a database failure', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(FIXTURES.daily_readiness))
      repo.upsertOuraDaily.mockRejectedValueOnce(new Error('db down'))
      const res = await POST(eventReq(EVENT))
      expect(res.status).toBe(503)
      expect(reportServerError).toHaveBeenCalledOnce()
    })

    it('answers 429 when rate limited, before reading the body', async () => {
      rateLimit.mockReturnValue(false)
      expect((await POST(eventReq(EVENT))).status).toBe(429)
    })

    it('answers 503 when the token key is missing: no stored grant could be opened', async () => {
      delete process.env.OURA_TOKEN_KEY
      expect((await POST(eventReq(EVENT))).status).toBe(503)
    })
  })
})
