// @vitest-environment jsdom
// K2: the cachedFetch failure channel. In jsdom isSQLiteAvailable() is false, so
// the cache layer uses localStorage — enough to exercise the onError contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch } from '../cache'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

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

  // Q-499 follow-on: two callers for the same key concurrently — the shape React
  // StrictMode's double effect-invoke produces on every dev render, and the shape
  // two different components reading the same key can produce for real. Before
  // this, only the ORIGINAL/owning caller's onError fired on failure; a joined
  // waiter with nothing cached to fall back on learned nothing and silently
  // vanished, defeating a card's own onError even though it was correctly wired.
  it('relays a failure to a joined waiter with no cache, not just the owning caller', async () => {
    const d = deferred<{ ok: boolean; status: number }>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(d.promise))

    const ownerOnError = vi.fn()
    const waiterOnError = vi.fn()
    const owner = cachedFetch('k-concurrent', '/x', 60, vi.fn(), { onError: ownerOnError })
    const waiter = cachedFetch('k-concurrent', '/x', 60, vi.fn(), { onError: waiterOnError })

    d.resolve({ ok: false, status: 429 })
    await Promise.all([owner, waiter])

    expect(ownerOnError).toHaveBeenCalledWith({ status: 429 })
    expect(waiterOnError).toHaveBeenCalledWith({ status: 429 })
  })

  it('does not relay a failure to a joined waiter that already had its own cached value', async () => {
    // Seed the key so a later caller for it paints from cache first.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ v: 1 }) }))
    await cachedFetch('k-concurrent-seeded', '/x', 60, vi.fn())

    const d = deferred<{ ok: boolean; status: number }>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(d.promise))

    const ownerOnError = vi.fn()
    const waiterOnError = vi.fn()
    const waiterOnData = vi.fn()
    const owner = cachedFetch('k-concurrent-seeded', '/x', 60, vi.fn(), { onError: ownerOnError })
    const waiter = cachedFetch('k-concurrent-seeded', '/x', 60, waiterOnData, { onError: waiterOnError })

    d.resolve({ ok: false, status: 500 })
    await Promise.all([owner, waiter])

    expect(waiterOnData).toHaveBeenCalledWith({ v: 1 }) // painted from its own cache first
    expect(waiterOnError).not.toHaveBeenCalled() // stale data beats an error state, per caller
  })
})
