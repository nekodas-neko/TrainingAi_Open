// @vitest-environment jsdom
// LB-128 — the failure channel `onError` structurally cannot reach.
//
// `onError` is gated on `cached === null` in BOTH of cachedFetchCore's failure branches, and
// joined waiters skip on `hadCached`. That gate is correct for what it guards: stale data beats an
// error card, and `useCachedValue`'s onError renders one. But it means a caller that has JUST
// WRITTEN — and therefore knows the painted value is out of date — could not hear that the refresh
// failed. RV-103's suggested fix ("pass onError") cannot reach this case.
//
// `onRevalidateError` is the complement: it fires only when a cached value WAS painted. The two are
// mutually exclusive by construction, which is what these cases pin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch } from '../cache'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

const ok = (v: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(v) })

async function seed(key: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ v: 1 })))
  await cachedFetch(key, '/x', 60, vi.fn())
}

describe('cachedFetch onRevalidateError (LB-128)', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setOnline(true) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fires on a non-ok response when a cached value WAS painted', async () => {
    await seed('rv-500')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const onRevalidateError = vi.fn(); const onError = vi.fn(); const onData = vi.fn()
    const hit = await cachedFetch('rv-500', '/x', 60, onData, { onError, onRevalidateError })
    expect(hit).toBe(true)
    expect(onData).toHaveBeenCalledWith({ v: 1 })        // the stale paint still happened
    expect(onRevalidateError).toHaveBeenCalledWith({ status: 503 })
    expect(onError).not.toHaveBeenCalled()               // and no error card
  })

  it('fires on a network throw when a cached value WAS painted and we are online', async () => {
    await seed('rv-net')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const onRevalidateError = vi.fn(); const onError = vi.fn()
    await cachedFetch('rv-net', '/x', 60, vi.fn(), { onError, onRevalidateError })
    expect(onRevalidateError).toHaveBeenCalledWith({ status: null })
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT fire while offline — offline with saved data is the sanctioned case', async () => {
    await seed('rv-off')
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const onRevalidateError = vi.fn(); const onError = vi.fn()
    await cachedFetch('rv-off', '/x', 60, vi.fn(), { onError, onRevalidateError })
    expect(onRevalidateError).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT fire when there was NOTHING cached — that is onError’s case, not this one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const onRevalidateError = vi.fn(); const onError = vi.fn()
    await cachedFetch('rv-cold', '/x', 60, vi.fn(), { onError, onRevalidateError })
    expect(onError).toHaveBeenCalledWith({ status: 500 })
    expect(onRevalidateError).not.toHaveBeenCalled()
  })

  it('does NOT fire when the revalidation succeeds', async () => {
    await seed('rv-good')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ v: 2 })))
    const onRevalidateError = vi.fn()
    await cachedFetch('rv-good', '/x', 60, vi.fn(), { onRevalidateError })
    expect(onRevalidateError).not.toHaveBeenCalled()
  })

  it('reaches a joined waiter that had its own cached value', async () => {
    await seed('rv-join')
    // One in-flight request, two callers. The second joins as a waiter; both painted from cache,
    // so both must hear the revalidation failure rather than neither.
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_res, rej) => setTimeout(() => rej(new Error('late')), 5))))
    const a = vi.fn(); const b = vi.fn()
    await Promise.all([
      cachedFetch('rv-join', '/x', 60, vi.fn(), { onRevalidateError: a }),
      cachedFetch('rv-join', '/x', 60, vi.fn(), { onRevalidateError: b }),
    ])
    expect(a).toHaveBeenCalledWith({ status: null })
    expect(b).toHaveBeenCalledWith({ status: null })
  })
})
