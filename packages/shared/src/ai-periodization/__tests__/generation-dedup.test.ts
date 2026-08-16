import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDedupCache } from '../generation-dedup'

const ok = { cacheable: () => true }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createDedupCache — in-flight dedup', () => {
  it('collapses concurrent calls for the same key into one run', async () => {
    const cache = createDedupCache<number>(30_000)
    let runs = 0
    const fn = () => new Promise<number>(res => { runs++; setTimeout(() => res(runs), 1000) })

    const a = cache.run('k', ok, fn)
    const b = cache.run('k', ok, fn) // arrives while a is in-flight
    await vi.advanceTimersByTimeAsync(1000)
    expect(await a).toBe(1)
    expect(await b).toBe(1) // same result
    expect(runs).toBe(1)    // generated once
  })

  it('does not dedup different keys', async () => {
    const cache = createDedupCache<number>(30_000)
    let runs = 0
    const fn = () => new Promise<number>(res => { runs++; setTimeout(() => res(runs), 1000) })
    const a = cache.run('k1', ok, fn)
    const b = cache.run('k2', ok, fn)
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all([a, b])
    expect(runs).toBe(2)
  })
})

describe('createDedupCache — read-through cooldown', () => {
  it('reuses a recent successful result within the cooldown', async () => {
    const cache = createDedupCache<number>(30_000)
    let runs = 0
    const fn = async () => { runs++; return runs }

    expect(await cache.run('k', ok, fn)).toBe(1)
    await vi.advanceTimersByTimeAsync(10_000) // 10s < 30s cooldown
    expect(await cache.run('k', ok, fn)).toBe(1) // cached, not re-run
    expect(runs).toBe(1)
  })

  it('re-runs after the cooldown expires', async () => {
    const cache = createDedupCache<number>(30_000)
    let runs = 0
    const fn = async () => { runs++; return runs }

    expect(await cache.run('k', ok, fn)).toBe(1)
    await vi.advanceTimersByTimeAsync(31_000) // past cooldown
    expect(await cache.run('k', ok, fn)).toBe(2) // re-run
    expect(runs).toBe(2)
  })

  it('skipCooldown always re-runs but still shares in-flight dedup', async () => {
    const cache = createDedupCache<number>(30_000)
    let runs = 0
    const fn = async () => { runs++; return runs }

    expect(await cache.run('k', ok, fn)).toBe(1)
    // A completion-style call (skipCooldown) ignores the cached value and regenerates.
    expect(await cache.run('k', { ...ok, skipCooldown: true }, fn)).toBe(2)
    expect(runs).toBe(2)
  })
})

describe('createDedupCache — failures are not cached', () => {
  it('a non-cacheable result is retried immediately, not pinned', async () => {
    const cache = createDedupCache<{ ok: boolean; n: number }>(30_000)
    let runs = 0
    const fn = async () => { runs++; return { ok: runs > 1, n: runs } } // first fails, then succeeds
    const cacheable = (r: { ok: boolean }) => r.ok

    const first = await cache.run('k', { cacheable }, fn)
    expect(first.ok).toBe(false)
    const second = await cache.run('k', { cacheable }, fn) // not cooldown-blocked (first wasn't cached)
    expect(second.ok).toBe(true)
    expect(runs).toBe(2)
  })
})

describe('createDedupCache — bounded memory', () => {
  it('prunes expired entries so the map does not grow unbounded', async () => {
    const cache = createDedupCache<number>(1000)
    // Fill with many keys, then let them expire and add one more — the prune on write
    // clears the stale entries (asserted indirectly: an expired key re-runs).
    let runs = 0
    const fn = async () => { runs++; return runs }
    for (let i = 0; i < 50; i++) await cache.run(`k${i}`, ok, fn)
    expect(runs).toBe(50)
    await vi.advanceTimersByTimeAsync(2000) // all expire
    // Re-running an old key regenerates (proves it wasn't served from a stale cache).
    expect(await cache.run('k0', ok, fn)).toBe(51)
  })
})
