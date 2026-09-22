/**
 * RV-85 — the helper written to stop a blank widget had no way to report that it had given up.
 *
 * It exists because `cachedFetch` surfaces data only on a cache hit or a 200, so a blip left the
 * readiness widget blank until the app was restarted. It retries three times and then returns
 * `void` with a `.catch(() => {})` — fixing the transient case and quietly accepting the persistent
 * one, landing on exactly the blank widget it was written to prevent, on Home.
 *
 * `onExhausted` is the missing channel. What these tests pin is the DISTINCTION it draws: an absent
 * value means "still trying" until the attempts are spent, and only then means "failed". A callback
 * that fired early would put a failure message under a request that was about to succeed.
 *
 * There were no tests for this file before. The retry counts and delays below are the shipped
 * behaviour, unchanged — they are pinned here because the exhaustion point is derived from them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/sqlite/cache', () => ({ cachedFetch: vi.fn(async () => false) }))

import { fetchWithRetry } from '@trainingai/shared/fetch-with-retry'

/** A stub in `cachedFetch`'s shape: calls `onData` only for the attempts listed in `respondsOn`. */
function stubFetch(respondsOn: number[] = [], payload: unknown = { ok: true }) {
  let attempt = 0
  const fn = vi.fn(async (_k: string, _u: string, _t: number, onData: (d: never) => void) => {
    const n = attempt++
    if (respondsOn.includes(n)) { onData(payload as never); return true }
    return false
  })
  return fn
}

/** Let every pending microtask settle — `.catch().finally()` is two turns deep. */
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }

/** Run out the full retry ladder: 2.5s, 5s, 7.5s, flushing promises between each. */
async function runOutRetries() {
  for (const ms of [2500, 5000, 7500]) {
    await vi.advanceTimersByTimeAsync(ms)
    await flush()
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('fetchWithRetry', () => {
  it('paints and stops when the first attempt responds', async () => {
    const fetchFn = stubFetch([0])
    const onData = vi.fn()
    const onExhausted = vi.fn()
    fetchWithRetry('k', '/u', 60, onData, () => false, 0, fetchFn, { onExhausted })
    await flush(); await runOutRetries()
    expect(onData).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onExhausted).not.toHaveBeenCalled()
  })

  it('retries three times and then reports exhaustion, once', async () => {
    const fetchFn = stubFetch([])
    const onExhausted = vi.fn()
    fetchWithRetry('k', '/u', 60, vi.fn(), () => false, 0, fetchFn, { onExhausted })
    await flush(); await runOutRetries()
    expect(fetchFn).toHaveBeenCalledTimes(4)   // the first attempt plus three retries
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  /**
   * The load-bearing one. A callback that fired on each failed attempt would put "didn't load"
   * under a request that then succeeded on the next try — worse than the blank it replaced.
   */
  it('stays silent while retries are still pending', async () => {
    const fetchFn = stubFetch([])
    const onExhausted = vi.fn()
    fetchWithRetry('k', '/u', 60, vi.fn(), () => false, 0, fetchFn, { onExhausted })
    await flush()
    expect(onExhausted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2500); await flush()
    expect(onExhausted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000); await flush()
    expect(onExhausted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(7500); await flush()
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('does not report exhaustion when a later attempt succeeds', async () => {
    const fetchFn = stubFetch([2])
    const onData = vi.fn()
    const onExhausted = vi.fn()
    fetchWithRetry('k', '/u', 60, onData, () => false, 0, fetchFn, { onExhausted })
    await flush(); await runOutRetries()
    expect(onData).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(onExhausted).not.toHaveBeenCalled()
  })

  /** An unmounted component has no state worth setting, and setting it is a React warning. */
  it('reports nothing once the caller is cancelled', async () => {
    const fetchFn = stubFetch([])
    const onExhausted = vi.fn()
    let cancelled = false
    fetchWithRetry('k', '/u', 60, vi.fn(), () => cancelled, 0, fetchFn, { onExhausted })
    await flush()
    cancelled = true
    await runOutRetries()
    expect(onExhausted).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  /**
   * Cancelling at attempt 0 does not pin this on its own, and neither does cancelling between
   * attempts — the timer's own `isCancelled()` guard stops the next call before the exhaustion
   * branch is ever reached, so a weaker guard inside `.finally` still passes. The case that
   * separates them is an unmount while the LAST attempt is in flight, which is the realistic one:
   * the ladder runs about fifteen seconds and the final request takes as long as a request takes.
   */
  it('reports nothing when the caller is cancelled during the final attempt', async () => {
    let releaseLast!: () => void
    const lastInFlight = new Promise<void>(resolve => { releaseLast = resolve })
    let attempt = 0
    const fetchFn = vi.fn(async () => {
      const n = attempt++
      if (n === 3) await lastInFlight
      return false
    })
    const onExhausted = vi.fn()
    let cancelled = false
    fetchWithRetry('k', '/u', 60, vi.fn(), () => cancelled, 0, fetchFn as never, { onExhausted })
    await flush()
    await runOutRetries()
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(onExhausted).not.toHaveBeenCalled()   // still in flight

    cancelled = true                              // the screen goes away
    releaseLast()
    await flush()
    expect(onExhausted).not.toHaveBeenCalled()
  })

  it('treats a rejecting fetch as no response, and still reports exhaustion', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('offline') })
    const onExhausted = vi.fn()
    fetchWithRetry('k', '/u', 60, vi.fn(), () => false, 0, fetchFn as never, { onExhausted })
    await flush(); await runOutRetries()
    expect(fetchFn).toHaveBeenCalledTimes(4)
    expect(onExhausted).toHaveBeenCalledTimes(1)
  })

  it('backs off 2.5s, 5s then 7.5s — the shipped ladder, unchanged', async () => {
    const fetchFn = stubFetch([])
    fetchWithRetry('k', '/u', 60, vi.fn(), () => false, 0, fetchFn)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2499); await flush()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4999); await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1); await flush()
    expect(fetchFn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(7500); await flush()
    expect(fetchFn).toHaveBeenCalledTimes(4)
  })

  /** Callers that want no channel keep working — the option bag is optional at every level. */
  it('needs no options at all', async () => {
    const fetchFn = stubFetch([])
    expect(() => fetchWithRetry('k', '/u', 60, vi.fn(), () => false, 0, fetchFn)).not.toThrow()
    await flush(); await runOutRetries()
    expect(fetchFn).toHaveBeenCalledTimes(4)
  })
})
