// @vitest-environment jsdom
// #2410 — a delete invalidates twice, before and after its push lands. The second round used to
// join the first round's GET, which was sent BEFORE the push and so answered with the pre-delete
// figure: the calorie card held 1,454 for 16 s while the server said 1,534. `invalidateCache` did
// not touch the in-flight map, so a refetch after it still joined a request that predated it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch, invalidateCache, readCacheSync } from '../cache'

const ok = (v: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(v) })
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('cachedFetch vs invalidateCache (#2410)', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('a refetch after an invalidation does not join a request sent before it', async () => {
    const before = deferred<unknown>()
    const after = deferred<unknown>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(before.promise)   // sent before the push landed
      .mockReturnValueOnce(after.promise)    // sent after
      .mockResolvedValue(ok({ kcal: 1534 }))
    vi.stubGlobal('fetch', fetchMock)

    const firstData = vi.fn(); const secondData = vi.fn()
    const first = cachedFetch('cal-budget', '/x', 60, firstData)
    await tick()
    await invalidateCache('cal-budget')
    const second = cachedFetch('cal-budget', '/x', 60, secondData)
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(2)       // it did not join the first

    before.resolve(ok({ kcal: 1454 }))               // the stale answer lands first
    await tick()
    after.resolve(ok({ kcal: 1534 }))
    await Promise.all([first, second])

    for (const spy of [firstData, secondData]) {
      expect(spy).not.toHaveBeenCalledWith({ kcal: 1454 })
      expect(spy).toHaveBeenLastCalledWith({ kcal: 1534 })
    }
    expect(readCacheSync('cal-budget')).toEqual({ kcal: 1534 })
  })

  it('a stale answer that lands AFTER the fresh one cannot overwrite it', async () => {
    const before = deferred<unknown>()
    const after = deferred<unknown>()
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise)
      .mockResolvedValue(ok({ kcal: 1534 })))
    const secondData = vi.fn()
    const first = cachedFetch('cal-late', '/x', 60, vi.fn())
    await tick()
    await invalidateCache('cal-late')
    const second = cachedFetch('cal-late', '/x', 60, secondData)
    await tick()
    after.resolve(ok({ kcal: 1534 }))
    await second
    before.resolve(ok({ kcal: 1454 }))
    await first
    expect(secondData).not.toHaveBeenCalledWith({ kcal: 1454 })
    expect(readCacheSync('cal-late')).toEqual({ kcal: 1534 })
  })

  it('still joins an in-flight request when nothing was invalidated (dedup unchanged)', async () => {
    const pending = deferred<unknown>()
    const fetchMock = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const a = vi.fn(); const b = vi.fn()
    const first = cachedFetch('dedup', '/x', 60, a)
    await tick()
    const second = cachedFetch('dedup', '/x', 60, b)
    await tick()
    pending.resolve(ok({ v: 1 }))
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith({ v: 1 })
    expect(b).toHaveBeenCalledWith({ v: 1 })
  })

  it('an invalidation of an unrelated prefix leaves the request alone', async () => {
    const pending = deferred<unknown>()
    const fetchMock = vi.fn().mockReturnValue(pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    const onData = vi.fn()
    const first = cachedFetch('weight-today', '/x', 60, onData)
    await tick()
    await invalidateCache('cal-')
    pending.resolve(ok({ v: 1 }))
    await first
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith({ v: 1 })
  })

  it('gives up after three attempts instead of looping on a key that keeps being invalidated', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      await invalidateCache('churn')               // every response is stale on arrival
      return ok({ v: 1 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onData = vi.fn()
    await cachedFetch('churn', '/x', 60, onData)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onData).not.toHaveBeenCalled()
  })
})
