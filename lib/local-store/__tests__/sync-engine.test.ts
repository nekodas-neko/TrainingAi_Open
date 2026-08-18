import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingMutation } from '../types'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getPendingMutations:    vi.fn(),
    deleteMutations:        vi.fn().mockResolvedValue(undefined),
    recordMutationFailures: vi.fn().mockResolvedValue(undefined),
    getFoodLogs:            vi.fn().mockResolvedValue([]),
    getStrandedPendingWorkouts: vi.fn().mockResolvedValue([]), // added in Task 9; harmless before
    requeueStrandedFoodItems: vi.fn().mockResolvedValue(0),
    queueMutation:          vi.fn().mockResolvedValue(undefined),
    getLastSyncAt:          vi.fn().mockResolvedValue(new Date('2026-07-01T00:00:00.000Z')),
    setLastSyncAt:          vi.fn().mockResolvedValue(undefined),
    applyDelta:             vi.fn().mockResolvedValue(undefined),
    markSleepSessionSynced:     vi.fn().mockResolvedValue(undefined),
    markOuraDailySummarySynced: vi.fn().mockResolvedValue(undefined),
    markOuraDailyDerivedSynced: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => fakeStore }))

import { pushMutations, pullDelta, restoreFromCloud, _resetSyncBackoff, isSyncBackedOff } from '../sync-engine'

// A fully-empty SyncDelta — every domain array present (unguarded mappers call .map on
// them directly) plus the cursor + hasMore the restore driver reads.
function emptyDelta(hasMore: boolean, syncedAt = '2026-07-02T00:00:00.000Z') {
  return {
    programs: [], programSessions: [], sessionExercises: [], schedules: [], scheduleDays: [],
    progressionStyles: [], styleSets: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
    activityLogs: [], fitnessTests: [], prescribedRuns: [], workoutSessions: [], exerciseLogs: [],
    setLogs: [], personalRecords: [], ouraDaily: [], ouraDailySummary: [], ouraDailyDerived: [],
    foodItems: [], foodLogs: [], supplements: [], supplementLogs: [], injuries: [], dayCheckins: [],
    syncedAt, hasMore,
  }
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

function mut(id: string, domain: PendingMutation['domain'], date: string): PendingMutation {
  return { id, userId: 'u1', domain, date, payload: { id: `payload-${id}` },
           createdAt: '2026-07-01T00:00:00.000Z', attempts: 0, lastError: null,
           status: 'pending', nextRetryAt: null }
}

describe('pushMutations', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetSyncBackoff() })

  it('deletes confirmed rows and records failures only for server-failed ids', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([
      mut('ob-1', 'food_logs', '2026-07-01'),
      mut('ob-2', 'food_logs', '2026-07-01'),
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ processed: 1, errors: [
        { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
      ] }),
    }))
    const res = await pushMutations('u1')
    expect(res).toEqual({ pushed: 1 })
    expect(fakeStore.deleteMutations).toHaveBeenCalledWith(['ob-1'])
    expect(fakeStore.recordMutationFailures).toHaveBeenCalledWith([
      { id: 'ob-2', error: 'FK ownership check failed' },
    ])
  })

  // ── Q-475: a database that cannot write arrives as HTTP 200 with per-item errors ──────────
  describe('a per-item error the server marked retryable', () => {
    const dbDown = (ids: string[]) => ({
      ok: true, status: 200,
      json: () => Promise.resolve({ processed: 0, errors: ids.map(id => ({
        id, domain: 'food_logs', date: '2026-07-01',
        error: 'Error: Failed query: insert into "food_logs" …', retryable: true,
      })) }),
    })

    it('does not count towards MAX_MUTATION_ATTEMPTS — the row stays queued, untouched', async () => {
      fakeStore.getPendingMutations.mockResolvedValue([
        mut('ob-1', 'food_logs', '2026-07-01'),
        mut('ob-2', 'food_logs', '2026-07-01'),
      ])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dbDown(['ob-1', 'ob-2'])))

      await pushMutations('u1')

      // The whole point: no attempts bump, so ~43 minutes of outage cannot dead-letter the queue.
      expect(fakeStore.recordMutationFailures).not.toHaveBeenCalled()
      expect(fakeStore.deleteMutations).not.toHaveBeenCalled()
    })

    it('engages the whole-queue backoff instead of resetting it', async () => {
      fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'food_logs', '2026-07-01')])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dbDown(['ob-1'])))

      expect(isSyncBackedOff()).toBe(false)
      await pushMutations('u1')
      expect(isSyncBackedOff()).toBe(true)
    })

    it('still records the non-retryable siblings in the same response', async () => {
      fakeStore.getPendingMutations.mockResolvedValue([
        mut('ob-1', 'food_logs', '2026-07-01'),
        mut('ob-2', 'food_logs', '2026-07-01'),
        mut('ob-3', 'food_logs', '2026-07-01'),
      ])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ processed: 1, errors: [
          { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
          { id: 'ob-3', domain: 'food_logs', date: '2026-07-01', error: 'db down', retryable: true },
        ] }),
      }))

      await pushMutations('u1')

      expect(fakeStore.recordMutationFailures).toHaveBeenCalledWith([
        { id: 'ob-2', error: 'FK ownership check failed' },
      ])
      // ob-1 succeeded and is confirmed even though the batch ended in a backoff.
      expect(fakeStore.deleteMutations).toHaveBeenCalledWith(['ob-1'])
    })

    it('an older server that sends no flag keeps the previous bounded-retry behaviour', async () => {
      fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'food_logs', '2026-07-01')])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ processed: 0, errors: [
          { id: 'ob-1', domain: 'food_logs', date: '2026-07-01', error: 'Error: Failed query: …' },
        ] }),
      }))

      await pushMutations('u1')

      expect(fakeStore.recordMutationFailures).toHaveBeenCalledWith([
        { id: 'ob-1', error: 'Error: Failed query: …' },
      ])
      expect(isSyncBackedOff()).toBe(false)
    })
  })

  it('runs the stranded-food-item heal before draining the outbox', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([])
    await pushMutations('u1')
    expect(fakeStore.requeueStrandedFoodItems).toHaveBeenCalledWith('u1')
  })

  it('records no per-item failure on a transport-level 5xx, and backs off the whole queue', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'body_metrics', '2026-07-01')])
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushMutations('u1')
    expect(res).toBeNull()
    expect(fakeStore.deleteMutations).not.toHaveBeenCalled()
    expect(fakeStore.recordMutationFailures).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second immediate call must not hit the network — the 5xx backoff gate
    // holds the whole queue back instead of hammering a struggling server.
    const res2 = await pushMutations('u1')
    expect(res2).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('backs off the whole queue on a 429 without recording a per-item failure', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'workout_log', '2026-07-01')])
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushMutations('u1')
    expect(res).toBeNull()
    expect(fakeStore.deleteMutations).not.toHaveBeenCalled()
    expect(fakeStore.recordMutationFailures).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Same whole-queue backoff gate as a 5xx — don't hammer a rate-limited server.
    const res2 = await pushMutations('u1')
    expect(res2).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('quarantines a whole chunk on a non-429 4xx and keeps draining subsequent chunks', async () => {
    const chunkA = Array.from({ length: 5 }, (_, i) => mut(`a-${i}`, 'food_logs', '2026-07-01'))
    const chunkB = [mut('b-0', 'food_logs', '2026-07-01')]
    fakeStore.getPendingMutations.mockResolvedValue([...chunkA, ...chunkB])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ processed: 1, errors: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await pushMutations('u1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fakeStore.recordMutationFailures).toHaveBeenCalledWith(
      chunkA.map(m => ({ id: m.id, error: 'push rejected: HTTP 400' })),
    )
    expect(fakeStore.deleteMutations).toHaveBeenCalledWith(['b-0'])
    expect(res).toEqual({ pushed: 1 })
  })

  // F4: the three Oura push domains flip sync_status on confirm, same as every other
  // domain. Currently inert in production (nothing queues these mutations until D2's
  // on-device rollup writer lands) but the wiring must be correct now so D2 doesn't
  // inherit a silent gap.
  it('marks a confirmed sleep_session mutation synced by its local row id', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'sleep_session', '2026-07-01')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: () => Promise.resolve({ processed: 1, errors: [] }) },
    ))
    const res = await pushMutations('u1')
    expect(res).toEqual({ pushed: 1 })
    expect(fakeStore.markSleepSessionSynced).toHaveBeenCalledWith('payload-ob-1')
  })

  it('marks confirmed oura_daily_summary/oura_daily_derived mutations synced by date', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([
      mut('ob-1', 'oura_daily_summary', '2026-07-01'),
      mut('ob-2', 'oura_daily_derived', '2026-07-01'),
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: () => Promise.resolve({ processed: 2, errors: [] }) },
    ))
    const res = await pushMutations('u1')
    expect(res).toEqual({ pushed: 2 })
    expect(fakeStore.markOuraDailySummarySynced).toHaveBeenCalledWith('2026-07-01')
    expect(fakeStore.markOuraDailyDerivedSynced).toHaveBeenCalledWith('2026-07-01')
  })
})

describe('pullDelta', () => {
  beforeEach(() => {
    vi.clearAllMocks(); _resetSyncBackoff()
    fakeStore.getLastSyncAt.mockResolvedValue(new Date('2026-07-01T00:00:00.000Z'))
  })

  it('backs off after a first-page pull failure instead of retrying on every forced call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)

    const res = await pullDelta('u1', true)
    expect(res).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A second forced call (mirroring another screen mounting during the same
    // outage) must not hit the network — the backoff gate holds it back.
    const res2 = await pullDelta('u1', true)
    expect(res2).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('restore=true hits the pull route with &mode=restore; a normal pull does not', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)
    await pullDelta('u1', true, false, true)
    expect(String(fetchMock.mock.calls[0][0])).toContain('mode=restore')

    _resetSyncBackoff()
    const fetchMock2 = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock2)
    await pullDelta('u1', true)
    expect(String(fetchMock2.mock.calls[0][0])).not.toContain('mode=restore')
  })

  it('surfaces hasMore on the outer return so a restore loop can drain past the page cap', async () => {
    // Page 0 says more remains, page 1 is drained → the single call ends hasMore=false.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(emptyDelta(true)))
      .mockResolvedValue(okJson(emptyDelta(false, '2026-07-03T00:00:00.000Z')))
    vi.stubGlobal('fetch', fetchMock)
    const res = await pullDelta('u1', true)
    expect(res).not.toBeNull()
    expect(res!.hasMore).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('restoreFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks(); _resetSyncBackoff()
    fakeStore.getLastSyncAt.mockResolvedValue(new Date('2026-07-01T00:00:00.000Z'))
  })

  it('seeds the cursor to epoch once and drains restore pulls until hasMore=false', async () => {
    // First pullDelta: page 0 hasMore, page 1 drained → returns hasMore=false → loop ends.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(emptyDelta(true)))
      .mockResolvedValue(okJson(emptyDelta(false, '2026-07-03T00:00:00.000Z')))
    vi.stubGlobal('fetch', fetchMock)

    const res = await restoreFromCloud('u1')
    expect(res).toEqual({ synced: 0, failed: false })
    // Seeded epoch once at loop entry (the resumable-restore fix).
    expect(fakeStore.setLastSyncAt).toHaveBeenCalledWith(new Date(0).toISOString())
    // Every pull in the restore drain carried mode=restore (full-history unclamp).
    for (const call of fetchMock.mock.calls) expect(String(call[0])).toContain('mode=restore')
  })

  it('reports failed:true (not a bare zero) when a pull fails, without looping forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)
    const res = await restoreFromCloud('u1')
    // A dead-network first page must be distinguishable from "genuinely nothing to restore" —
    // the caller (profile-tab) branches on `failed` to show an error instead of a false-positive
    // success toast. The cursor is still resumable (persisted up to the last successful page).
    expect(res).toEqual({ synced: 0, failed: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
