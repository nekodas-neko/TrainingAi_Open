import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-JS simulation of the 104_rate_limits upsert: increment within the
// window, reset when window_start has expired.
const db = vi.hoisted(() => ({
  rows: new Map<string, { count: number; windowStartMs: number }>(),
  failing: false,
}))

vi.mock('@/lib/data/postgres/client', () => ({
  ensureSchema: vi.fn(async () => {}),
  getPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (db.failing) throw new Error('connection refused')
      if (sql.startsWith('DELETE')) return { rows: [] }
      const [key, inc, windowSec] = params as [string, number, number]
      const now = Date.now()
      const row = db.rows.get(key)
      if (!row || row.windowStartMs <= now - windowSec * 1000) {
        db.rows.set(key, { count: inc, windowStartMs: now })
      } else {
        row.count += inc
      }
      const r = db.rows.get(key)!
      return { rows: [{ count: String(r.count), window_start_ms: String(r.windowStartMs) }] }
    }),
  }),
}))

import { rateLimit, _awaitRateLimitFlushes, _resetRateLimitL1 } from '../rate-limit'

beforeEach(() => {
  _resetRateLimitL1()
  db.rows.clear()
  db.failing = false
})

describe('rateLimit', () => {
  it('allows exactly `limit` calls in a window, then denies', async () => {
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 1
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 2
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 3
    expect(rateLimit('k:a', 3, 60_000)).toBe(false)  // count would be 4 > 3
    await _awaitRateLimitFlushes()
    expect(db.rows.get('k:a')!.count).toBe(3)        // denied call is not flushed
  })

  it('resets after the window expires', () => {
    vi.useFakeTimers()
    expect(rateLimit('k:b', 1, 60_000)).toBe(true)
    expect(rateLimit('k:b', 1, 60_000)).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(rateLimit('k:b', 1, 60_000)).toBe(true)
    vi.useRealTimers()
  })

  it('treats the DB count as authoritative: a fresh L1 with the DB at the limit denies from the second call', async () => {
    // Simulate a prior replica/deploy having consumed the whole window.
    db.rows.set('k:c', { count: 5, windowStartMs: Date.now() })
    expect(rateLimit('k:c', 5, 60_000)).toBe(true)   // L1 is empty — fast path allows (accepted 1-request lag)
    await _awaitRateLimitFlushes()                   // flush returns count 6 → L1 count := 6
    expect(rateLimit('k:c', 5, 60_000)).toBe(false)
  })

  it('falls back to memory-only enforcement when the DB is down', async () => {
    db.failing = true
    expect(rateLimit('k:d', 2, 60_000)).toBe(true)
    expect(rateLimit('k:d', 2, 60_000)).toBe(true)
    expect(rateLimit('k:d', 2, 60_000)).toBe(false)  // in-memory limit still enforced
    await _awaitRateLimitFlushes()                   // must not throw / unhandled-reject
  })

  it('coalesces concurrent increments into the shared store', async () => {
    for (let i = 0; i < 4; i++) rateLimit('k:e', 10, 60_000)
    await _awaitRateLimitFlushes()
    expect(db.rows.get('k:e')!.count).toBe(4)
  })
})
