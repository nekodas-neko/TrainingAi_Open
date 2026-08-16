// `offFetchJson` has to keep two answers apart: OFF saying "no such product", and OFF not answering
// at all. They used to collapse into one `notFound` on the barcode route, so during Open Food Facts'
// 2026-08-13 outage every scan told the owner their food was not in the database.
//
// Pure fetch-shape tests — no DB, no network.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { offFetchJson, OFF_USER_AGENT } from '../open-food-facts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function mockFetch(...responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i++, responses.length - 1)]
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  }) as typeof fetch
  return calls
}

describe('offFetchJson', () => {
  it('returns the parsed body on success', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 1, product: { code: '123' } } })
    await expect(offFetchJson('https://off.test/p')).resolves.toEqual({ status: 1, product: { code: '123' } })
  })

  it('sends the shared User-Agent', async () => {
    const calls = mockFetch({ ok: true, status: 200, body: {} })
    await offFetchJson('https://off.test/p')
    expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toBe(OFF_USER_AGENT)
  })

  it('returns null on a 502 — an outage is not an empty result', async () => {
    mockFetch({ ok: false, status: 502 })
    await expect(offFetchJson('https://off.test/p')).resolves.toBeNull()
  })

  it('does not retry a non-503 failure', async () => {
    const calls = mockFetch({ ok: false, status: 502 })
    await offFetchJson('https://off.test/p')
    expect(calls).toHaveLength(1)
  })

  it('retries a 503 once, since that is usually our own rate limiting', async () => {
    const calls = mockFetch({ ok: false, status: 503 }, { ok: true, status: 200, body: { ok: 1 } })
    await expect(offFetchJson('https://off.test/p')).resolves.toEqual({ ok: 1 })
    expect(calls).toHaveLength(2)
  })

  it('gives up after two 503s rather than looping', async () => {
    const calls = mockFetch({ ok: false, status: 503 })
    await expect(offFetchJson('https://off.test/p')).resolves.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('propagates a thrown fetch so the caller can tell it apart from a clean miss', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('aborted') }) as typeof fetch
    await expect(offFetchJson('https://off.test/p')).rejects.toThrow('aborted')
  })
})
