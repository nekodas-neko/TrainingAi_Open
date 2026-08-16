import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedFetch, cachedFetchToday, readTodayCacheSync, invalidateCache, isBodyMetadataFresh, isWorkoutDataToday } from '../sqlite/cache'
import { todayInTz } from '@trainingai/shared/date-utils'

// Proxy-backed so Object.keys(localStorage) enumerates stored keys the same way
// real browser localStorage does — lsInvalidate relies on that to bulk-delete by prefix.
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  const methods: Record<string, unknown> = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
  return new Proxy({} as Storage, {
    get(_target, prop) {
      if (prop === 'length') return store.size
      if (prop in methods) return methods[prop as string]
      return store.get(prop as string)
    },
    ownKeys() { return Array.from(store.keys()) },
    getOwnPropertyDescriptor(_target, prop) {
      if (store.has(prop as string)) return { enumerable: true, configurable: true, value: store.get(prop as string) }
      return undefined
    },
  })
}

describe('cachedFetch — in-flight dedup fan-out', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('two concurrent calls on a cold key both receive the fresh payload via a single fetch', async () => {
    let resolveFetch!: (value: unknown) => void
    const fetchPromise = new Promise((resolve) => { resolveFetch = resolve })
    const fetchSpy = vi.fn(() => fetchPromise)
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    const p1 = cachedFetch('dedup-test-key', '/api/dedup-test', 60, (d) => received.push(d))
    const p2 = cachedFetch('dedup-test-key', '/api/dedup-test', 60, (d) => received.push(d))

    // Let both calls run past their cache-read and in-flight check before the
    // network resolves, so the second call has a chance to join as a waiter
    // (or wrongly fire its own fetch, which is exactly what this test guards against).
    await Promise.resolve()
    await Promise.resolve()

    resolveFetch({ ok: true, json: async () => ({ hello: 'world' }) })
    await Promise.all([p1, p2])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(received).toEqual([{ hello: 'world' }, { hello: 'world' }])
  })
})

describe('cachedFetch — freshWithinTtl short-circuit', () => {
  let storage: Storage
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'))
    storage = makeMemoryStorage()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', makeMemoryStorage())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('skips the network fetch when the cached entry is within its real ttlSeconds', async () => {
    const entry = { data: { v: 1 }, expiresAt: Date.now() + 24 * 60 * 60 * 1000, cachedAt: Date.now() }
    storage.setItem('ta_cache:fresh-key', JSON.stringify(entry))

    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    const hit = await cachedFetch('fresh-key', '/api/fresh-key', 60, d => received.push(d), { freshWithinTtl: true })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(hit).toBe(true)
    expect(received).toEqual([{ v: 1 }])
  })

  it('still fetches when the cached entry is older than its real ttlSeconds (localStorage floor keeps it non-expired)', async () => {
    const cachedAt = Date.now() - 120_000 // written 2 min ago
    const entry = { data: { v: 1 }, expiresAt: Date.now() + 24 * 60 * 60 * 1000, cachedAt }
    storage.setItem('ta_cache:stale-key', JSON.stringify(entry))

    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ v: 2 }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    await cachedFetch('stale-key', '/api/stale-key', 60, d => received.push(d), { freshWithinTtl: true })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(received).toEqual([{ v: 1 }, { v: 2 }])
  })

  it('fetches on a cold key (no cached entry) regardless of freshWithinTtl', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ v: 3 }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    await cachedFetch('missing-key', '/api/missing-key', 60, d => received.push(d), { freshWithinTtl: true })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(received).toEqual([{ v: 3 }])
  })

  it('a write-group invalidation forces the next read to fetch even though the entry was fresh', async () => {
    const entry = { data: { v: 1 }, expiresAt: Date.now() + 24 * 60 * 60 * 1000, cachedAt: Date.now() }
    storage.setItem('ta_cache:invalidated-key', JSON.stringify(entry))
    await invalidateCache('invalidated-key')

    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ v: 4 }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    await cachedFetch('invalidated-key', '/api/invalidated-key', 60, d => received.push(d), { freshWithinTtl: true })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(received).toEqual([{ v: 4 }])
  })
})

describe('readTodayCacheSync — day-boundary guard', () => {
  let storage: Storage
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'))
    storage = makeMemoryStorage()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', makeMemoryStorage())
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('ignores an entry stored for a previous day (does not flash yesterday\'s data)', () => {
    // Same on-disk shape lsSet/setCached produce: an `ls entry` wrapping the
    // {date, data} envelope cachedFetchToday's `toStored` writes.
    const entry = { data: { date: '2026-07-02', data: { score: 1 } }, expiresAt: Date.now() + 60_000 }
    storage.setItem('ta_cache:stale-today-key', JSON.stringify(entry))
    expect(readTodayCacheSync('stale-today-key')).toBeNull()
  })

  it('returns the payload for an entry stored earlier today', () => {
    const entry = { data: { date: todayInTz(), data: { score: 2 } }, expiresAt: Date.now() + 60_000 }
    storage.setItem('ta_cache:fresh-today-key', JSON.stringify(entry))
    expect(readTodayCacheSync('fresh-today-key')).toEqual({ score: 2 })
  })

  it('cachedFetchToday round-trip: a fetched payload is wrapped in the envelope and reads back correctly the same day', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ days: [1, 2, 3] }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const received: unknown[] = []
    await cachedFetchToday('weekly-stats-rt', '/api/weekly-stats', 60, d => received.push(d))
    expect(received).toEqual([{ days: [1, 2, 3] }])

    // The stored shape must be the {date, data} envelope — a bare/raw write from a
    // different code path (e.g. a stale writer using plain cachedFetch/setCached)
    // would fail this exact round-trip, which is the Task 1 regression this guards.
    expect(readTodayCacheSync('weekly-stats-rt')).toEqual({ days: [1, 2, 3] })
  })
})

describe('isBodyMetadataFresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('treats a payload with no today record as fresh (nothing logged yet, not stale)', () => {
    expect(isBodyMetadataFresh({ today: null })).toBe(true)
    expect(isBodyMetadataFresh(null)).toBe(true)
    expect(isBodyMetadataFresh(undefined)).toBe(true)
  })

  it('treats a today record stamped with today\'s date as fresh', () => {
    expect(isBodyMetadataFresh({ today: { date: todayInTz() } })).toBe(true)
  })

  it('rejects a today record stamped with a previous day', () => {
    expect(isBodyMetadataFresh({ today: { date: '2026-07-02' } })).toBe(false)
  })
})

describe('isWorkoutDataToday', () => {
  afterEach(() => { vi.useRealTimers() })

  it('rejects a payload with no dataDate (older cache entry)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z')) // 2026-07-03 22:00 AEST
    expect(isWorkoutDataToday(null)).toBe(false)
    expect(isWorkoutDataToday(undefined)).toBe(false)
    expect(isWorkoutDataToday({})).toBe(false)
  })

  it('accepts a payload dataDate matching AEST today just before midnight (23:59 local)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T13:59:00Z')) // 2026-07-03 23:59 AEST
    expect(isWorkoutDataToday({ dataDate: '2026-07-03' })).toBe(true)
    expect(isWorkoutDataToday({ dataDate: '2026-07-04' })).toBe(false)
  })

  it('rolls over to reject yesterday\'s dataDate just after midnight (00:01 local)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T14:01:00Z')) // 2026-07-04 00:01 AEST
    expect(isWorkoutDataToday({ dataDate: '2026-07-03' })).toBe(false)
    expect(isWorkoutDataToday({ dataDate: '2026-07-04' })).toBe(true)
  })
})
