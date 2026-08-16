// @vitest-environment jsdom
// K2: the cachedFetch failure channel. In jsdom isSQLiteAvailable() is false, so
// the cache layer uses localStorage — enough to exercise the onError contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch } from '../cache'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

describe('cachedFetch onError channel (K2)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setOnline(true)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fires onError with the HTTP status on a non-ok response and no cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const onError = vi.fn()
    const onData = vi.fn()
    const hit = await cachedFetch('k-500', '/x', 60, onData, { onError })
    expect(hit).toBe(false)
    expect(onData).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith({ status: 500 })
  })

  it('fires onError with null status on a network throw while online', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-ish')))
    const onError = vi.fn()
    await cachedFetch('k-net', '/x', 60, vi.fn(), { onError })
    expect(onError).toHaveBeenCalledWith({ status: null })
  })

  it('does NOT fire onError on a network throw while offline (offline is not an error)', async () => {
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const onError = vi.fn()
    await cachedFetch('k-off', '/x', 60, vi.fn(), { onError })
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT fire onError when a cache seed was already painted (stale beats error)', async () => {
    // Seed the cache with a successful fetch first.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ v: 1 }) }))
    await cachedFetch('k-seed', '/x', 60, vi.fn())

    // Now the server fails, but we have cached data — no error should surface.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const onError = vi.fn()
    const onData = vi.fn()
    const hit = await cachedFetch('k-seed', '/x', 60, onData, { onError })
    expect(hit).toBe(true)
    expect(onData).toHaveBeenCalledWith({ v: 1 }) // painted from cache
    expect(onError).not.toHaveBeenCalled()
  })
})
