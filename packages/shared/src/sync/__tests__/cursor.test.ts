import { describe, it, expect } from 'vitest'
import { resolveSyncCursor } from '../cursor'

const now = new Date('2026-07-01T10:00:00.000Z')

describe('resolveSyncCursor', () => {
  it('returns now / no-more when no domain hit its page limit', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T09:00:00.000Z'), hitLimit: false },
      { maxUpdatedAt: null, hitLimit: false },
    ], now)
    expect(r).toEqual({ syncedAt: now.toISOString(), hasMore: false })
  })

  it('cursors to 1ms before the earliest capped domain max (overlap, never skip)', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T08:00:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:30:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:59:00.000Z'), hitLimit: false },
    ], now)
    expect(r.hasMore).toBe(true)
    expect(r.syncedAt).toBe(new Date('2026-07-01T07:59:59.999Z').toISOString())
  })
})
