// The webhook subscription renewal job (#2859), with Oura's subscription API mocked at `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OURA_API_BASE } from '../config'
import { ensureOuraWebhookSubscriptions, RENEW_WITHIN_MS, WANTED_SUBSCRIPTIONS } from '../subscriptions'
import { startOuraWebhookRenewal } from '../renewal'
import type { OuraWebhookConfig } from '../webhook'
import { jsonResponse } from './fixtures'

const NOW = Date.parse('2026-10-14T02:00:00Z')
const CALLBACK = 'https://trainingai.example/api/oura/webhook'
const CONFIG: OuraWebhookConfig = {
  oauth: { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://trainingai.example/api/oura/callback' },
  callbackUrl: CALLBACK,
  verificationToken: 'vt-123',
}
const BASE = `${OURA_API_BASE}/v2/webhook/subscription`

interface Sub { id: string; callback_url: string; event_type: string; data_type: string; expiration_time: string }

/** A stand-in for Oura's subscription store, answering the five calls the job makes. */
function fakeOura(initial: Sub[] = []) {
  const subs = [...initial]
  let n = 0
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = []
  const handler = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body, headers: init?.headers as Record<string, string> })
    if (method === 'GET' && url === BASE) return jsonResponse(subs)
    if (method === 'POST' && url === BASE) {
      const sub = { id: `new-${++n}`, callback_url: body.callback_url, event_type: body.event_type, data_type: body.data_type, expiration_time: new Date(NOW + 90 * 86_400_000).toISOString() }
      subs.push(sub)
      return jsonResponse(sub, 201)
    }
    const renew = url.match(/\/renew\/(.+)$/)
    if (method === 'PUT' && renew) {
      const sub = subs.find(s => s.id === decodeURIComponent(renew[1]))
      if (!sub) return new Response('', { status: 403 })
      sub.expiration_time = new Date(NOW + 90 * 86_400_000).toISOString()
      return jsonResponse(sub)
    }
    return new Response('', { status: 500 })
  })
  return { subs, calls, handler }
}

const sub = (id: string, data_type: string, event_type: string, expiresInMs: number, callback = CALLBACK): Sub =>
  ({ id, callback_url: callback, data_type, event_type, expiration_time: new Date(NOW + expiresInMs).toISOString() })

describe('Oura webhook subscription renewal (#2859)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates every wanted subscription when none exist, with client credentials, never a user token', async () => {
    const oura = fakeOura()
    vi.stubGlobal('fetch', oura.handler)
    const report = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    expect(report.created).toHaveLength(WANTED_SUBSCRIPTIONS.length)
    expect(report.failed).toEqual([])
    const posts = oura.calls.filter(c => c.method === 'POST')
    expect(posts).toHaveLength(WANTED_SUBSCRIPTIONS.length)
    for (const c of oura.calls) {
      expect(c.headers['x-client-id']).toBe('cid')
      expect(c.headers['x-client-secret']).toBe('csecret')
      expect(c.headers.Authorization).toBeUndefined()
    }
    expect(posts[0].body).toEqual({ callback_url: CALLBACK, verification_token: 'vt-123', event_type: 'create', data_type: 'daily_readiness' })
    expect(posts.map(p => `${(p.body as Sub).data_type}:${(p.body as Sub).event_type}`)).toContain('sleep:delete')
    // #3087: a workout deleted in the Oura app is tombstoned, so its delete is subscribed too.
    expect(posts.map(p => `${(p.body as Sub).data_type}:${(p.body as Sub).event_type}`)).toContain('workout:delete')
  })

  it('does nothing on a second run', async () => {
    const oura = fakeOura()
    vi.stubGlobal('fetch', oura.handler)
    await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    oura.calls.length = 0
    const again = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    expect(again.current).toHaveLength(WANTED_SUBSCRIPTIONS.length)
    expect(again.created).toEqual([])
    expect(again.renewed).toEqual([])
    expect(oura.calls.map(c => c.method)).toEqual(['GET'])
  })

  it('renews one close to expiry, keeps one that is current, and ignores other callback URLs', async () => {
    const oura = fakeOura([
      sub('a', 'daily_readiness', 'create', RENEW_WITHIN_MS - 60_000),
      sub('b', 'daily_readiness', 'update', RENEW_WITHIN_MS + 60_000),
      sub('old', 'daily_sleep', 'create', -86_400_000, 'https://old.example/hook'),
    ])
    vi.stubGlobal('fetch', oura.handler)
    const report = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    expect(report.renewed).toEqual(['daily_readiness:create'])
    expect(report.current).toEqual(['daily_readiness:update'])
    expect(report.created).toHaveLength(WANTED_SUBSCRIPTIONS.length - 2)
    expect(oura.calls.some(c => c.url.includes('/old'))).toBe(false)
    expect(oura.calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('replaces an expired subscription Oura no longer knows (403 on renew)', async () => {
    const oura = fakeOura([sub('gone', 'sleep', 'update', -1000)])
    // The list still shows it, but Oura answers the renew with 403.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/renew/gone')) return new Response('', { status: 403 })
      return oura.handler(input, init)
    }))
    const report = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    expect(report.created).toContain('sleep:update')
    expect(report.failed).toEqual([])
  })

  it('reports a create that fails and carries on with the rest', async () => {
    const oura = fakeOura()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'POST' && JSON.parse(String(init.body)).data_type === 'workout') return new Response('{}', { status: 422 })
      return oura.handler(input, init)
    }))
    const report = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })
    expect(report.failed.map(f => f.subscription)).toEqual(['workout:create', 'workout:update', 'workout:delete'])
    expect(report.created).toHaveLength(WANTED_SUBSCRIPTIONS.length - 3)
  })

  it('a dry run lists what it would do and changes nothing at Oura', async () => {
    const oura = fakeOura([sub('a', 'daily_readiness', 'create', 1000)])
    vi.stubGlobal('fetch', oura.handler)
    const report = await ensureOuraWebhookSubscriptions(CONFIG, { dryRun: true, now: NOW })
    expect(report.renewed).toEqual(['daily_readiness:create'])
    expect(report.created).toHaveLength(WANTED_SUBSCRIPTIONS.length - 1)
    expect(oura.calls.map(c => c.method)).toEqual(['GET'])
  })

  it('throws when the list cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('', { status: 401 })))
    await expect(ensureOuraWebhookSubscriptions(CONFIG, { dryRun: false, now: NOW })).rejects.toThrow(/answered 401/)
  })
})

describe('startOuraWebhookRenewal (#2859)', () => {
  const env = {
    NODE_ENV: 'production', OURA_CLIENT_ID: 'cid', OURA_CLIENT_SECRET: 'cs', OURA_REDIRECT_URI: 'https://x.example/api/oura/callback',
    OURA_WEBHOOK_CALLBACK_URL: CALLBACK, OURA_WEBHOOK_VERIFICATION_TOKEN: 'vt',
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never starts outside production or without every webhook setting', () => {
    expect(startOuraWebhookRenewal({ ...env, NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false)
    expect(startOuraWebhookRenewal({ ...env, NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false)
    expect(startOuraWebhookRenewal({ ...env, OURA_WEBHOOK_VERIFICATION_TOKEN: '' } as NodeJS.ProcessEnv)).toBe(false)
    expect(startOuraWebhookRenewal({ ...env, OURA_CLIENT_SECRET: '' } as NodeJS.ProcessEnv)).toBe(false)
  })
})
