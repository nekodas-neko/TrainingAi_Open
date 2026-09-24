// @vitest-environment jsdom
// BF-195 — the owner: "I went to an area with low reception and nothing really worked on the app."
//
// Low reception is NOT offline. The radio stays attached, so `navigator.onLine` and Capacitor's
// `networkStatusChange` both report true, the offline branch never runs, and a request issued on a
// connection that carries nothing simply never settles. `refreshing` stays true and the screen holds
// its skeleton — there was no path from "hanging" to any rendered state.
//
// These cases pin the two halves of the fix: the request now FAILS instead of hanging, and the app
// now knows the difference between "the radio is attached" and "requests are completing".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch, requestsCompleting, subscribeToReachability, __resetReachabilityForTests } from '../cache'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

const ok = (v: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(v) })

/** What `AbortSignal.timeout` rejects with. The NAME is what the code discriminates on. */
const timeoutError = () => new DOMException('The operation timed out.', 'TimeoutError')

async function seed(key: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ v: 1 })))
  await cachedFetch(key, '/x', 60, vi.fn())
}

describe('BF-195 — low reception, not offline', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setOnline(true); __resetReachabilityForTests() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('passes an abort signal, so the request cannot hang forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ v: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await cachedFetch('bf195-signal', '/x', 60, vi.fn())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal, 'the fetch is issued with a timeout signal').toBeInstanceOf(AbortSignal)
  })

  it('a timeout with cached data keeps the cached paint and reports a failed revalidation', async () => {
    await seed('bf195-cached')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError()))
    const onData = vi.fn(); const onError = vi.fn(); const onRevalidateError = vi.fn()
    await cachedFetch('bf195-cached', '/x', 60, onData, { onError, onRevalidateError })
    expect(onData).toHaveBeenCalledWith({ v: 1 })   // the saved data is still shown
    expect(onError).not.toHaveBeenCalled()          // and NOT replaced by an error card
    // Offline-with-saved-data is the sanctioned case, so once a timeout has marked us unreachable
    // this is no longer reported as a live failure.
    expect(onRevalidateError).not.toHaveBeenCalled()
  })

  it('a timeout with NOTHING cached SETTLES — which is what clears the skeleton', async () => {
    // The Workout tab's case: seed empty and the fetch never settling. What held the skeleton was
    // not a missing error callback — `session-select-content.tsx` clears `refreshing` in a
    // `finally` — it was that the promise never settled at all, so the `finally` never ran.
    // Settling IS the fix; this asserts the mechanism rather than a symptom.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError()))
    const onError = vi.fn()
    const settled = await Promise.race([
      cachedFetch('bf195-empty', '/x', 60, vi.fn(), { onError }).then(() => 'settled'),
      new Promise(r => setTimeout(() => r('hung'), 1000)),
    ])
    expect(settled).toBe('settled')

    // And it is reported as OFFLINE, not as a server error: once requests have stopped completing
    // the app is in the sanctioned offline-first state, where an error card would be wrong. The
    // screen shows its empty state and the banner tells the truth, which is the entry's
    // "treat a timed-out fetch as offline for display purposes".
    expect(onError).not.toHaveBeenCalled()
  })

  it('marks requests as not completing on a timeout, and notifies subscribers', async () => {
    const seen: boolean[] = []
    subscribeToReachability(v => seen.push(v))
    expect(requestsCompleting()).toBe(true)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError()))
    await cachedFetch('bf195-flag', '/x', 60, vi.fn(), { onError: vi.fn() })

    expect(requestsCompleting(), 'the radio is attached but nothing is getting through').toBe(false)
    expect(seen).toEqual([false])
  })

  it('a settled response marks us reachable again — INCLUDING one the server rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError()))
    await cachedFetch('bf195-recover', '/x', 60, vi.fn(), { onError: vi.fn() })
    expect(requestsCompleting()).toBe(false)

    // A 500 is proof the connection carried a request and brought an answer back, which is the
    // question this flag asks. Requiring `ok` would leave the app stuck "offline" behind a server
    // error on a perfectly good connection.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await cachedFetch('bf195-recover2', '/x', 60, vi.fn(), { onError: vi.fn() })
    expect(requestsCompleting()).toBe(true)
  })

  it('an ORDINARY network failure does not claim low reception', async () => {
    // DNS failure, connection refused, server down. Deliberately NOT the same state: it is already
    // handled, and calling it "no reception" would put an Offline banner in front of a working
    // connection.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await cachedFetch('bf195-hard', '/x', 60, vi.fn(), { onError: vi.fn() })
    expect(requestsCompleting()).toBe(true)
  })

  it('still reports a real server error while requests ARE completing', async () => {
    // The regression guard for the flag: gating on it must not swallow genuine errors.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const onError = vi.fn()
    await cachedFetch('bf195-503', '/x', 60, vi.fn(), { onError })
    expect(onError).toHaveBeenCalledWith({ status: 503 })
  })
})
