import { describe, it, expect } from 'vitest'
import { resolveSyncCursor, SYNC_PULL_OVERLAP_MS } from '../cursor'

const pullStartedAt = new Date('2026-07-01T10:00:00.000Z')

describe('resolveSyncCursor', () => {
  it('a drained pull cursors to its start minus the overlap, so a late commit is re-read (#3654)', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T09:00:00.000Z'), hitLimit: false },
      { maxUpdatedAt: null, hitLimit: false },
    ], pullStartedAt)
    expect(r).toEqual({ syncedAt: new Date(pullStartedAt.getTime() - SYNC_PULL_OVERLAP_MS).toISOString(), hasMore: false })
    expect(Date.parse(r.syncedAt)).toBeLessThan(pullStartedAt.getTime())
  })

  it('an incomplete pull cursors to the earliest capped domain max, exactly: its ties are in the page (#3672)', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T08:00:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:30:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:59:00.000Z'), hitLimit: false },
    ], pullStartedAt)
    expect(r).toEqual({ syncedAt: '2026-07-01T08:00:00.000Z', hasMore: true })
  })
})
