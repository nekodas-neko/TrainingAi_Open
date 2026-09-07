/**
 * PS-39: 150 of 222 API routes have no test importing their handler. These are two of the ones that
 * would hurt most — the unauthenticated ingest routes, where the failure mode is not a broken screen
 * but a silent one.
 *
 * `health-connect/ingest` is the only unauthenticated write into `body_metrics`, gated by a shared
 * secret. CLAUDE.md's rule for it is one line: **security checks fail CLOSED** — a missing signing
 * key is a rejection, not a skip. That is exactly the shape a refactor breaks without any test going
 * red, because the happy path keeps working.
 *
 * `client-error` is the pipe that fills `error_events`, which CLAUDE.md calls "the only view of
 * faults that never reach a human". A route that quietly stops recording is the one failure nobody
 * would notice, since its symptom is an absence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upsertBodyMetrics = vi.fn(async () => undefined)
const insertErrorEvent = vi.fn(async () => undefined)
const getUserById = vi.fn(async () => ({ id: 'u-1', timezone: 'Australia/Brisbane' }))

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ upsertBodyMetrics, insertErrorEvent, getUserById }),
  getRepositoryAsync: async () => ({ upsertBodyMetrics, insertErrorEvent, getUserById }),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1' } }) }))

import { POST as ingest } from '@/app/api/health-connect/ingest/route'
import { POST as clientError } from '@/app/api/client-error/route'

const SECRET = 'a-secret-that-is-long-enough-to-compare'
const WEBHOOK_USER = '00000000-0000-4000-8000-0000000000u1'.replace('u1', '0e1')

const post = (handler: (req: never) => Promise<Response>, url: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  }) as never)

/** A fresh IP per case: the route rate-limits every attempt per IP, so cases would otherwise
 *  throttle each other and pass for the wrong reason. */
let ipCounter = 0
const freshIp = () => ({ 'x-forwarded-for': `198.51.100.${++ipCounter}` })

beforeEach(() => {
  upsertBodyMetrics.mockClear()
  insertErrorEvent.mockClear()
  process.env.HEALTH_CONNECT_INGEST_SECRET = SECRET
  process.env.WEBHOOK_USER_ID = WEBHOOK_USER
})
afterEach(() => {
  delete process.env.HEALTH_CONNECT_INGEST_SECRET
})

describe('health-connect/ingest fails closed', () => {
  it('refuses when the secret does not match, and writes nothing', async () => {
    const res = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: 'wrong', steps: 5000 }, freshIp())
    expect(res.status).toBe(401)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('refuses when the server has NO secret configured — a missing key is a rejection, not a skip', async () => {
    // The rule this pins (CLAUDE.md, AI & Security Defaults): the Oura webhook once skipped
    // verification when its header was absent. An unset env var must not become an open door.
    delete process.env.HEALTH_CONNECT_INGEST_SECRET
    const res = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: SECRET, steps: 5000 }, freshIp())
    expect(res.status).toBe(401)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('refuses an empty secret against an empty configured one', async () => {
    // The degenerate case a naive equality check passes: '' === ''.
    process.env.HEALTH_CONNECT_INGEST_SECRET = ''
    const res = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: '', steps: 5000 }, freshIp())
    expect(res.status).toBe(401)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('rejects a body the schema does not recognise before it reaches the driver', async () => {
    const res = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: SECRET, steps: '75kg' }, freshIp())
    expect(res.status).toBe(400)
    expect(upsertBodyMetrics).not.toHaveBeenCalled()
  })

  it('answers a bad secret and a rate-limit trip identically', async () => {
    // SEC-I3: the limiter's response must stay indistinguishable from a bad secret, or the
    // difference is an oracle telling an attacker their guess was merely throttled.
    const ip = { 'x-forwarded-for': '198.51.100.250' }
    const bad = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: 'wrong', steps: 1 }, ip)
    const badBody = await bad.json()

    let tripped: Response | null = null
    for (let i = 0; i < 40; i++) {
      const res = await post(ingest, 'http://localhost/api/health-connect/ingest', { secret: 'wrong', steps: 1 }, ip)
      if (res.status === 401 && i > 20) { tripped = res; break }
    }
    expect(tripped).not.toBeNull()
    expect(await tripped!.json()).toEqual(badBody)
  })
})

describe('client-error records what it is given, and refuses what it cannot', () => {
  it('writes the event, truncating each field to its column bound', async () => {
    const res = await post(clientError, 'http://localhost/api/client-error', {
      message: 'm'.repeat(3000), stack: 's'.repeat(9000), url: 'u'.repeat(600),
    })
    expect(res.status).toBe(200)
    expect(insertErrorEvent).toHaveBeenCalledTimes(1)
    const row = insertErrorEvent.mock.calls[0][0] as { message: string; stack: string; url: string; source: string }
    expect(row.source).toBe('client')
    expect(row.message).toHaveLength(2000)
    expect(row.stack).toHaveLength(8000)
    expect(row.url).toHaveLength(500)
  })

  it('refuses a body with no message rather than filing a blank fault', async () => {
    // A blank row in `error_events` is worse than none: the table is read by grouping on message,
    // so an empty one is a bucket that says nothing and hides how often it happened.
    for (const body of [{}, { message: '' }, { message: 42 }]) {
      insertErrorEvent.mockClear()
      const res = await post(clientError, 'http://localhost/api/client-error', body)
      expect(res.status).toBe(400)
      expect(insertErrorEvent).not.toHaveBeenCalled()
    }
  })

  it('keeps a null stack and url rather than coercing them to strings', async () => {
    const res = await post(clientError, 'http://localhost/api/client-error', { message: 'boom' })
    expect(res.status).toBe(200)
    const row = insertErrorEvent.mock.calls[0][0] as { stack: string | null; url: string | null }
    expect(row.stack).toBeNull()
    expect(row.url).toBeNull()
  })
})
