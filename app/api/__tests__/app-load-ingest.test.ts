// BF-19 — the ingest route's unusual contract, pinned so it is not "fixed" later.
//
// **It answers 200 to a body it rejected.** That looks wrong and is deliberate: the client sends
// this with `navigator.sendBeacon`, whose response is unobservable — nothing can read a 400 and
// nothing could act on one. A 4xx here would surface only as noise in the very error log this
// feature exists to keep readable. The row is dropped and the reason is logged server-side, where
// someone can act on it.
//
// What is NOT relaxed: auth, the rate limit, and the body-size cap all still refuse.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertAppLoadMetric = vi.fn(async () => {})
const auth = vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }))
const rateLimit = vi.fn(() => true)

vi.mock('@/auth', () => ({ auth: (...a: unknown[]) => auth(...(a as [])) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => ({ insertAppLoadMetric })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }))

import { POST } from '@/app/api/app-load/route'

const post = (body: unknown) => POST(new Request('http://x/api/app-load', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

const valid = { route: '/health/readiness', totalMs: 900, cold: true }

beforeEach(() => {
  insertAppLoadMetric.mockClear()
  rateLimit.mockReturnValue(true)
  auth.mockResolvedValue({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })
})

describe('POST /api/app-load', () => {
  it('stores a valid report', async () => {
    const res = await post({ ...valid, responseStartMs: 120, domContentMs: 700, buildId: 'abc' })
    expect(res.status).toBe(200)
    expect(insertAppLoadMetric).toHaveBeenCalledWith({
      userId: 'u1', route: '/health/readiness', totalMs: 900, cold: true,
      responseStartMs: 120, domContentMs: 700, buildId: 'abc',
    })
  })

  it('accepts a report with only the required fields', async () => {
    expect((await post(valid)).status).toBe(200)
    expect(insertAppLoadMetric).toHaveBeenCalledTimes(1)
  })

  // The contract this file exists for.
  it('answers 200 to a malformed body but stores nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ route: '/x', totalMs: 'not a number', cold: true })
    expect(res.status).toBe(200)
    expect(insertAppLoadMetric).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()   // logged where someone can act on it
    warn.mockRestore()
  })

  it('drops an unknown field rather than storing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ ...valid, somethingElse: 'x' })
    expect(res.status).toBe(200)
    expect(insertAppLoadMetric).not.toHaveBeenCalled()  // `.strict()`
    warn.mockRestore()
  })

  it('drops an implausible duration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await post({ ...valid, totalMs: 999_999_999 })
    expect(insertAppLoadMetric).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // Auth and the rate limit are NOT relaxed by the 200-on-malformed rule above.
  it('refuses an unauthenticated report', async () => {
    auth.mockResolvedValue(null as never)
    const res = await post(valid)
    expect(res.status).toBe(401)
    expect(insertAppLoadMetric).not.toHaveBeenCalled()
  })

  it('refuses when the rate limit is exhausted', async () => {
    rateLimit.mockReturnValue(false)
    const res = await post(valid)
    expect(res.status).toBe(429)
    expect(insertAppLoadMetric).not.toHaveBeenCalled()
  })

  it('scopes the row to the session user, never to anything in the body', async () => {
    await post({ ...valid, userId: 'someone-else' })
    // `.strict()` rejects the extra key outright, so the row is dropped rather than mis-scoped.
    expect(insertAppLoadMetric).not.toHaveBeenCalled()
  })
})
