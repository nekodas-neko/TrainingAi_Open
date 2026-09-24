// @vitest-environment jsdom
// BF-195 — the owner: "I went to an area with low reception and nothing really worked on the app."
//
// Low reception is NOT offline. The radio stays attached, so `navigator.onLine` and Capacitor's
// `networkStatusChange` both report true, the offline branch never runs, and a request issued on a
// connection that carries nothing simply never settles. `refreshing` stays true and the screen holds
// its skeleton — there was no path from "hanging" to any rendered state.
//
// The first version of this fix aborted the request at the threshold. That was wrong in both
// directions: it destroyed slow-but-working requests (the exact case a lifter on a weak connection
// is in) and it made every GET retry-prone — CI ran the E2E suite against a dev server whose
// first-compile responses take 9–19s, the aborts fired, and a spec asserting "a same-day resume
// must not refetch" saw two. The watchdog here OBSERVES instead: the request always runs to
// completion, and slowness is reported without touching it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch, requestsCompleting, subscribeToReachability, __resetReachabilityForTests } from '../cache'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

const ok = (v: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(v) })

/** A request that is still in flight — the low-reception shape, never a rejection. */
function pending<T>() {
  let settle!: (v: T) => void
  const promise = new Promise<T>(resolve => { settle = resolve })
  return { promise, settle }
}

/** Past the watchdog threshold, with the request still outstanding. */
async function waitOutTheWatchdog() {
  await vi.advanceTimersByTimeAsync(8_000)
}

describe('BF-195 — low reception, not offline', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setOnline(true); __resetReachabilityForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('does NOT cancel the request — a slow response still delivers its data', async () => {
    // The regression guard for the E2E break. A request that takes longer than the threshold is
    // reported as slow and then ARRIVES; the caller gets its data, not an error.
    vi.useFakeTimers()
    const slow = pending<ReturnType<typeof ok>>()
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => slow.promise)
    vi.stubGlobal('fetch', fetchMock)

    const onData = vi.fn(); const onError = vi.fn()
    const call = cachedFetch('bf195-slow-arrives', '/x', 60, onData, { onError })
    await waitOutTheWatchdog()

    const init = fetchMock.mock.calls[0][1]!
    expect(Object.keys(init), 'no abort signal — the request is observed, not cancelled').toEqual(['cache'])

    slow.settle(ok({ v: 7 }))
    await call
    expect(onData, 'the slow answer still arrives').toHaveBeenCalledWith({ v: 7 })
    expect(onError).not.toHaveBeenCalled()
  })

  it('ONE slow response is not a diagnosis — the app stays online', async () => {
    // A cold container, a heavy aggregate or a dev server compiling on demand all produce a single
    // long request on a perfectly good connection. Crying offline at the first one is the failure
    // mode this threshold exists to avoid.
    vi.useFakeTimers()
    const slow = pending<ReturnType<typeof ok>>()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => slow.promise))

    const call = cachedFetch('bf195-one-slow', '/x', 60, vi.fn(), { onError: vi.fn() })
    await waitOutTheWatchdog()
    expect(requestsCompleting(), 'one slow request is not low reception').toBe(true)

    slow.settle(ok({ v: 1 }))
    await call
  })

  it('a RUN of slow responses marks us unreachable, and notifies subscribers', async () => {
    vi.useFakeTimers()
    const seen: boolean[] = []
    subscribeToReachability(v => seen.push(v))
    expect(requestsCompleting()).toBe(true)

    const a = pending<ReturnType<typeof ok>>(); const b = pending<ReturnType<typeof ok>>()
    const queue = [a.promise, b.promise]
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => queue.shift()!))

    const first = cachedFetch('bf195-run-1', '/x', 60, vi.fn(), { onError: vi.fn() })
    const second = cachedFetch('bf195-run-2', '/y', 60, vi.fn(), { onError: vi.fn() })
    await waitOutTheWatchdog()

    expect(requestsCompleting(), 'the radio is attached but nothing is getting through').toBe(false)
    expect(seen).toEqual([false])

    a.settle(ok({ v: 1 })); b.settle(ok({ v: 2 }))
    await Promise.all([first, second])
  })

  it('a settled response marks us reachable again — INCLUDING one the server rejected', async () => {
    vi.useFakeTimers()
    const a = pending<ReturnType<typeof ok>>(); const b = pending<ReturnType<typeof ok>>()
    const queue = [a.promise, b.promise]
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => queue.shift()!))
    const first = cachedFetch('bf195-recover-1', '/x', 60, vi.fn(), { onError: vi.fn() })
    const second = cachedFetch('bf195-recover-2', '/y', 60, vi.fn(), { onError: vi.fn() })
    await waitOutTheWatchdog()
    expect(requestsCompleting()).toBe(false)

    // A 500 is proof the connection carried a request and brought an answer back, which is the
    // question this flag asks. Requiring `ok` would leave the app stuck "offline" behind a server
    // error on a perfectly good connection.
    a.settle({ ok: false, status: 500 } as unknown as ReturnType<typeof ok>)
    await first
    expect(requestsCompleting()).toBe(true)

    b.settle(ok({ v: 2 }))
    await second
  })

  it('a settled response RESETS the run, so the next slow one starts from zero', async () => {
    // Without the reset the count only ever climbs: one recovery followed by one slow request
    // would trip the threshold, which is the "one slow request is not a diagnosis" rule undone
    // by the back door.
    vi.useFakeTimers()
    const a = pending<ReturnType<typeof ok>>(); const b = pending<ReturnType<typeof ok>>()
    const c = pending<ReturnType<typeof ok>>()
    const queue = [a.promise, b.promise, c.promise]
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => queue.shift()!))

    const first = cachedFetch('bf195-reset-1', '/x', 60, vi.fn(), { onError: vi.fn() })
    const second = cachedFetch('bf195-reset-2', '/y', 60, vi.fn(), { onError: vi.fn() })
    await waitOutTheWatchdog()
    expect(requestsCompleting()).toBe(false)

    a.settle(ok({ v: 1 })); b.settle(ok({ v: 2 }))
    await Promise.all([first, second])
    expect(requestsCompleting()).toBe(true)

    const third = cachedFetch('bf195-reset-3', '/z', 60, vi.fn(), { onError: vi.fn() })
    await waitOutTheWatchdog()
    expect(requestsCompleting(), 'one slow request after a recovery is still just one').toBe(true)
    c.settle(ok({ v: 3 }))
    await third
  })

  it('a request that settles quickly never counts as slow', async () => {
    // The watchdog has to be cleared when the response arrives. Left armed, a fast request would
    // report itself slow 8s later — and two fast requests would then fake low reception outright.
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => ok({ v: 1 })))
    await cachedFetch('bf195-fast-1', '/x', 60, vi.fn(), { onError: vi.fn() })
    await cachedFetch('bf195-fast-2', '/y', 60, vi.fn(), { onError: vi.fn() })

    await waitOutTheWatchdog()
    expect(requestsCompleting(), 'their watchdogs were disarmed on arrival').toBe(true)
  })

  it('an ORDINARY network failure does not claim low reception', async () => {
    // DNS failure, connection refused, server down. Deliberately NOT the same state: it is already
    // handled, and calling it "no reception" would put an Offline banner in front of a working
    // connection.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('Failed to fetch') }))
    await cachedFetch('bf195-hard', '/x', 60, vi.fn(), { onError: vi.fn() })
    expect(requestsCompleting()).toBe(true)
  })

  it('a failed request still SETTLES, which is what clears the skeleton', async () => {
    // The Workout tab's case: `session-select-content.tsx` clears `refreshing` in a `finally`, so
    // what held the skeleton was the promise never settling at all. Settling IS the fix.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('Failed to fetch') }))
    const settled = await Promise.race([
      cachedFetch('bf195-empty', '/x', 60, vi.fn(), { onError: vi.fn() }).then(() => 'settled'),
      new Promise(r => setTimeout(() => r('hung'), 1000)),
    ])
    expect(settled).toBe('settled')
  })

  it('still reports a real server error while requests ARE completing', async () => {
    // The regression guard for the flag: gating on it must not swallow genuine errors.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: false, status: 503 })))
    const onError = vi.fn()
    await cachedFetch('bf195-503', '/x', 60, vi.fn(), { onError })
    expect(onError).toHaveBeenCalledWith({ status: 503 })
  })
})
