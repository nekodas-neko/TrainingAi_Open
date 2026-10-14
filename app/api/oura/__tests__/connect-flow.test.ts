// The Oura connect flow end to end through the three routes, with Oura mocked at `fetch` (#2858).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { OuraCloudTokenRow, SaveOuraCloudTokensInput } from '@/lib/data/postgres/slices/oura-cloud-tokens'
import { decryptOuraToken } from '@/lib/oura/cloud/token-cipher'
import { createConnectTicket } from '@/lib/oura/cloud/connect-ticket'
import { OURA_AUTHORIZE_URL, OURA_REVOKE_URL } from '@/lib/oura/cloud/config'

const USER = '11111111-1111-4111-8111-111111111111'
const ATTACKER = '33333333-3333-4333-8333-333333333333'
const ORIGIN = 'http://localhost:3000'

const authMock = vi.fn<() => Promise<{ user: { id: string } } | null>>(async () => ({ user: { id: USER } }))
const rateLimit = vi.fn(() => true)
let row: OuraCloudTokenRow | null = null
const user = { id: USER, isActive: true }
const repo = {
  getUserById: vi.fn(async (id: string) => (id === USER ? user : id === ATTACKER ? { id: ATTACKER, isActive: true } : null)),
  getOuraCloudTokens: vi.fn(async (id: string) => (row?.userId === id ? row : null)),
  saveOuraCloudTokens: vi.fn(async (id: string, input: SaveOuraCloudTokensInput) => {
    row = { userId: id, accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt, scope: input.scope, ouraUserId: input.ouraUserId ?? null, updatedAt: new Date() }
  }),
  deleteOuraCloudTokens: vi.fn(async (id: string) => { const had = row?.userId === id; row = null; return had }),
}

vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...args: unknown[]) => rateLimit(...(args as [])) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => repo }))
// The history read a connect starts (#2859) is covered in its own tests; here it must only start.
const startBackfill = vi.hoisted(() => vi.fn())
vi.mock('@/lib/oura/cloud/backfill', () => ({ startOuraConnectBackfill: startBackfill }))

import { POST as startConnect, GET as openConnect } from '../connect/route'
import { GET as callback } from '../callback/route'
import { GET as connection, DELETE as disconnect } from '../connection/route'
import { POST as complete } from '../connect/complete/route'

const fetchMock = vi.fn<typeof fetch>()
const ENV = {
  AUTH_SECRET: 'test-auth-secret-at-least-32-characters!!',
  OURA_CLIENT_ID: 'cid',
  OURA_CLIENT_SECRET: 'csecret',
  OURA_REDIRECT_URI: `${ORIGIN}/api/oura/callback`,
  OURA_TOKEN_KEY: 'k'.repeat(48),
}

function post(body?: unknown) {
  return new NextRequest(`${ORIGIN}/api/oura/connect`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

/** POST, then open the link in a "browser": returns the redirect and the cookie it set. */
async function startAndOpen(client = 'web') {
  const res = await startConnect(post({ client }))
  expect(res.status).toBe(200)
  const { url } = await res.json()
  const opened = await openConnect(new NextRequest(url))
  const cookie = opened.cookies.get('ta_oura_connect')
  return { url: new URL(url), opened, cookie: cookie?.value ?? '' }
}

function callbackReq(params: Record<string, string>, cookie?: string) {
  const req = new NextRequest(`${ORIGIN}/api/oura/callback?${new URLSearchParams(params)}`)
  if (cookie) req.cookies.set('ta_oura_connect', cookie)
  return req
}

function completeReq(body: unknown) {
  return new NextRequest(`${ORIGIN}/api/oura/connect/complete`, { method: 'POST', body: JSON.stringify(body) })
}

function oauthResponses() {
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 86400, scope: 'daily' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'oura-u1' }), { status: 200 }))
}

describe('Oura connect routes (#2858)', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v }
    row = null
    startBackfill.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    authMock.mockResolvedValue({ user: { id: USER } })
    rateLimit.mockReturnValue(true)
  })
  afterEach(() => {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    vi.unstubAllGlobals()
  })

  it('needs a signed-in user to start', async () => {
    authMock.mockResolvedValueOnce(null)
    expect((await startConnect(post())).status).toBe(401)
  })

  it('is rate limited', async () => {
    rateLimit.mockReturnValueOnce(false)
    expect((await startConnect(post())).status).toBe(429)
  })

  it('refuses a client that is not on the native allow-list', async () => {
    expect((await startConnect(post({ client: 'evil-app' }))).status).toBe(400)
    expect((await startConnect(post({ client: 'web', extra: 1 }))).status).toBe(400)
  })

  it('fails closed with 503 when OURA_TOKEN_KEY or the OAuth settings are missing', async () => {
    delete process.env.OURA_TOKEN_KEY
    expect((await startConnect(post())).status).toBe(503)
    process.env.OURA_TOKEN_KEY = ENV.OURA_TOKEN_KEY
    delete process.env.OURA_CLIENT_SECRET
    expect((await startConnect(post())).status).toBe(503)
  })

  it('opens Oura consent with the pinned scopes and a state, and sets the nonce cookie', async () => {
    const { url, opened, cookie } = await startAndOpen()
    expect(url.origin).toBe(ORIGIN)
    expect(opened.status).toBe(302)
    const to = new URL(opened.headers.get('location')!)
    expect(`${to.origin}${to.pathname}`).toBe(OURA_AUTHORIZE_URL)
    expect(to.searchParams.get('scope')).toBe('personal daily heartrate workout session spo2Daily')
    expect(to.searchParams.get('redirect_uri')).toBe(ENV.OURA_REDIRECT_URI)
    expect(to.searchParams.get('state')).toBe(url.searchParams.get('ticket'))
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const set = opened.headers.get('set-cookie')!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/Path=\/api\/oura/)
    expect(set).toMatch(/SameSite=lax/i)
  })

  it('refuses to open a forged or expired ticket', async () => {
    const res = await openConnect(new NextRequest(`${ORIGIN}/api/oura/connect?ticket=forged`))
    expect(res.status).toBe(400)
  })

  it('web: completes, stores encrypted tokens and returns to Devices', async () => {
    const { url, cookie } = await startAndOpen('web')
    oauthResponses()
    const res = await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/more/devices?oura=connected`)
    expect(decryptOuraToken(row!.accessToken, USER, 'access_token')).toBe('acc-1')
    expect(row!.accessToken).not.toContain('acc-1')
    expect(res.headers.get('set-cookie')).toMatch(/ta_oura_connect=;/)
    expect(await (await connection()).json()).toMatchObject({ connected: true, scope: 'daily' })
    expect(startBackfill).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('native: the browser leg stores nothing; the app completes with its own bearer', async () => {
    const { url, cookie } = await startAndOpen('android-preview')
    authMock.mockResolvedValue(null) // the system browser carries no session
    oauthResponses()
    const res = await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    const back = res.headers.get('location')!
    expect(back.startsWith('com.trainingai.app.preview:/oura/callback?oura=pending&handle=')).toBe(true)
    expect(back).not.toContain('acc-1')
    expect(row).toBeNull()
    expect(startBackfill).not.toHaveBeenCalled()

    authMock.mockResolvedValue({ user: { id: USER } }) // the app's bearer
    const handle = new URLSearchParams(back.split('?')[1]).get('handle')!
    const done = await complete(completeReq({ handle }))
    expect(await done.json()).toEqual({ connected: true })
    expect(decryptOuraToken(row!.accessToken, USER, 'access_token')).toBe('acc-1')
    expect(startBackfill).toHaveBeenCalledExactlyOnceWith(USER)
  })

  it('attack: a native link sent to a victim cannot land the victim\'s grant on the sender\'s account', async () => {
    authMock.mockResolvedValue({ user: { id: ATTACKER } })
    const { url, cookie } = await startAndOpen('android') // the attacker's ticket, opened in the victim's browser
    authMock.mockResolvedValue(null)
    oauthResponses() // the victim approves at Oura
    const res = await callback(callbackReq({ code: 'victim-code', state: url.searchParams.get('ticket')! }, cookie))
    const handle = new URLSearchParams(res.headers.get('location')!.split('?')[1]).get('handle')!
    expect(row).toBeNull()

    // The deep link opens the VICTIM's app, which completes with the victim's bearer.
    authMock.mockResolvedValue({ user: { id: USER } })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const refused = await complete(completeReq({ handle }))
    expect(refused.status).toBe(403)
    expect(row).toBeNull()
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
  })

  it('complete refuses a forged, tampered or missing handle, and an unsigned-in app', async () => {
    expect((await complete(completeReq({ handle: 'p1.forged.x.y' }))).status).toBe(410)
    expect((await complete(completeReq({}))).status).toBe(400)
    expect((await complete(completeReq({ handle: 'x', extra: 1 }))).status).toBe(400)
    authMock.mockResolvedValue(null)
    expect((await complete(completeReq({ handle: 'x' }))).status).toBe(401)
    expect(row).toBeNull()
  })

  it('attack: a web link sent to a signed-out victim exchanges nothing', async () => {
    authMock.mockResolvedValue({ user: { id: ATTACKER } })
    const { url, cookie } = await startAndOpen('web')
    authMock.mockResolvedValue(null) // the victim's browser is not signed in to TrainingAI
    const res = await callback(callbackReq({ code: 'victim-code', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.headers.get('location')).toBe(`${ORIGIN}/more/devices?oura=error&reason=signed_out`)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row).toBeNull()
  })

  it('CSRF: a callback without the cookie from the browser that started it connects nothing', async () => {
    const { url } = await startAndOpen('web')
    const res = await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }))
    expect(res.headers.get('location')).toBe(`${ORIGIN}/more/devices?oura=error&reason=expired`)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row).toBeNull()
  })

  it('CSRF: another connect attempt\'s cookie does not match this state', async () => {
    const first = await startAndOpen('web')
    const second = await startAndOpen('web')
    const res = await callback(callbackReq({ code: 'c1', state: first.url.searchParams.get('ticket')! }, second.cookie))
    expect(res.headers.get('location')).toContain('reason=expired')
    expect(row).toBeNull()
  })

  it('a forged state gets a plain 400 and no redirect anywhere', async () => {
    const res = await callback(callbackReq({ code: 'c1', state: 'forged' }, 'x'.repeat(43)))
    expect(res.status).toBe(400)
    expect(res.headers.get('location')).toBeNull()
  })

  it('attack: a web link sent to a victim signed in as themselves exchanges nothing', async () => {
    authMock.mockResolvedValue({ user: { id: ATTACKER } })
    const { url, cookie } = await startAndOpen('web')
    authMock.mockResolvedValue({ user: { id: USER } })
    const res = await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.headers.get('location')).toContain('reason=signed_out')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(row).toBeNull()
  })

  it('a callback with the settings gone answers plainly and redirects nowhere', async () => {
    const { url, cookie } = await startAndOpen('web')
    delete process.env.OURA_REDIRECT_URI
    const res = await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.status).toBe(503)
    expect(res.headers.get('location')).toBeNull()
  })

  it('the user declining at Oura returns "denied" without calling Oura', async () => {
    const { url, cookie } = await startAndOpen('android')
    const res = await callback(callbackReq({ error: 'access_denied', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.headers.get('location')).toBe('com.trainingai.app:/oura/callback?oura=error&reason=denied')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a deactivated account connects nothing', async () => {
    const { ticket, nonce } = await createConnectTicket(USER, 'web')
    user.isActive = false
    try {
      const res = await callback(callbackReq({ code: 'c1', state: ticket }, nonce))
      expect(res.headers.get('location')).toContain('reason=failed')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      user.isActive = true
    }
  })

  it('an Oura error during the exchange returns "failed" and stores nothing', async () => {
    const { url, cookie } = await startAndOpen('web')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    const res = await callback(callbackReq({ code: 'used', state: url.searchParams.get('ticket')! }, cookie))
    expect(res.headers.get('location')).toContain('reason=failed')
    expect(row).toBeNull()
  })

  it('disconnect revokes and deletes; the status then reads not connected', async () => {
    const { url, cookie } = await startAndOpen('web')
    oauthResponses()
    await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const res = await disconnect()
    expect(await res.json()).toEqual({ disconnected: true, revoked: true })
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(`${OURA_REVOKE_URL}?access_token=acc-1`)
    expect(await (await connection()).json()).toEqual({ connected: false, scope: null, expiresAt: null })
  })

  it('status and disconnect need a signed-in user', async () => {
    authMock.mockResolvedValue(null)
    expect((await connection()).status).toBe(401)
    expect((await disconnect()).status).toBe(401)
  })

  it('no response body ever carries a token', async () => {
    const { url, cookie } = await startAndOpen('web')
    oauthResponses()
    await callback(callbackReq({ code: 'c1', state: url.searchParams.get('ticket')! }, cookie))
    const text = JSON.stringify(await (await connection()).json())
    expect(text).not.toContain('acc-1')
    expect(text).not.toContain('ref-1')
    expect(text).not.toContain('v1.')
  })
})
