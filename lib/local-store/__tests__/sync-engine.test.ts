import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingMutation } from '../types'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getPendingMutations:    vi.fn(),
    deleteMutations:        vi.fn().mockResolvedValue(undefined),
    recordMutationFailures: vi.fn().mockResolvedValue(undefined),
    getFoodLogs:            vi.fn().mockResolvedValue([]),
    markFoodLogSynced:      vi.fn().mockResolvedValue(undefined),
    getInjuries:            vi.fn().mockResolvedValue([]),
    upsertInjury:           vi.fn().mockResolvedValue(undefined),
    markInjurySynced:       vi.fn().mockResolvedValue(undefined),
    getSupplementLogs:      vi.fn().mockResolvedValue([]),
    upsertSupplementLog:    vi.fn().mockResolvedValue(undefined),
    markSupplementLogSynced: vi.fn().mockResolvedValue(undefined),
    markPlanMealAnswerSynced: vi.fn().mockResolvedValue(undefined),
    upsertFoodLog:          vi.fn().mockResolvedValue(undefined),
    getStrandedPendingWorkouts: vi.fn().mockResolvedValue([]), // added in Task 9; harmless before
    requeueStrandedFoodItems: vi.fn().mockResolvedValue(0),
    requeueStrandedFoodTombstones: vi.fn().mockResolvedValue(0),
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

const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

describe('pushMutations', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetSyncBackoff() })

  // DV-8. The whole batch's outbox entries used to be deleted BEFORE the mark-synced loop ran,
  // and that loop is unguarded — so one throwing arm left every row after it `pending` with its
  // outbox entry already gone. Nothing retries a mutation that is no longer queued, and
  // `applyDelta` only overwrites `synced` rows, so the row is stranded permanently. That is the
  // signature measured on the phone: pending locally, both outboxes empty, delete applied
  // server-side, 36 food tombstones over 14 days plus a set_logs row.
  //
  // Asserted here as a property of the ORDER rather than of any one domain: the arm chosen to
  // throw is incidental, and a fix that only hardened that arm would leave the shape intact.
  it('does not strand a row when a later confirm step throws (DV-8)', async () => {
    // ob-2 is a DELETE, which is what DV-8 is made of: a tombstone confirms by key, so a
    // missed mark leaves a row no later pull can correct.
    const tombstone = mut('ob-2', 'food_logs', '2026-07-01')
    tombstone.payload = { id: 'food-1', deleted: true }
    fakeStore.getPendingMutations.mockResolvedValue([
      mut('ob-1', 'injuries', '2026-07-01'),
      tombstone,
    ])
    fakeStore.getInjuries.mockRejectedValueOnce(new Error('local read blew up'))
    global.fetch = vi.fn().mockResolvedValue(okJson({ processed: 2, errors: [] })) as never

    await pushMutations('u1')

    // The survivor must still be confirmed — one bad arm cannot take its siblings down.
    expect(fakeStore.markFoodLogSynced).toHaveBeenCalledWith('food-1')
    // And the row that could not be confirmed keeps its outbox entry, so the next push retries
    // it. Deleting it is what makes the strand permanent.
    const deleted = fakeStore.deleteMutations.mock.calls.flatMap(c => c[0] as string[])
    expect(deleted).toContain('ob-2')
    expect(deleted).not.toContain('ob-1')
    // And it must SAY so. This path deliberately does not dead-letter (the server applied the
    // write, so counting it as a failure would misreport a success), which leaves the log as the
    // only way a repeating confirm failure is ever noticed — swallowing it re-creates exactly the
    // invisibility that let DV-8 accumulate 36 rows over 14 days.
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('confirm failed'), 'injuries', expect.any(Error))
  })

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

  it('sweeps stranded food tombstones on the SAME grace period as the workout sweep (DV-8)', async () => {
    // Both sweeps look for a row with no outbox entry, and a push still in flight looks exactly
    // like that. Two different cutoffs would mean one of them queues a duplicate.
    fakeStore.getPendingMutations.mockResolvedValue([])
    await pushMutations('u1')

    expect(fakeStore.requeueStrandedFoodTombstones).toHaveBeenCalledTimes(1)
    const [userId, cutoff] = fakeStore.requeueStrandedFoodTombstones.mock.calls[0]
    expect(userId).toBe('u1')
    expect(cutoff).toBe(fakeStore.getStrandedPendingWorkouts.mock.calls[0][0])
    // Five minutes back, not "now" — a zero grace period is the duplicate-queue bug.
    expect(Date.now() - Date.parse(cutoff as string)).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it('still drains the outbox when the tombstone sweep throws', async () => {
    // Every sweep in this block is best-effort: the queue must drain even if a heal fails.
    fakeStore.requeueStrandedFoodTombstones.mockRejectedValueOnce(new Error('local read failed'))
    fakeStore.getPendingMutations.mockResolvedValue([])
    await expect(pushMutations('u1')).resolves.toEqual({ pushed: 0 })
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

describe('DV-5 — a confirmed food-log DELETE must not stay pending', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetSyncBackoff() })

  // The row is already tombstoned when the push is confirmed, and `getFoodLogs` filters
  // `deleted_at IS NULL` — so the read-then-upsert path finds nothing, the `if (rec)` guard
  // silently does nothing, and the outbox entry is dropped anyway. The tombstone is then
  // `pending` forever, and `applyDelta` only ever overwrites `synced` rows, so no later server
  // correction can reach it. Measured on the S25: 33 such rows back to 2026-08-19.
  it('marks the tombstone synced by id rather than re-reading a row that is filtered out', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([
      { id: 'ob-del', userId: 'u1', domain: 'food_logs', date: '2026-07-01',
        payload: { id: 'food-row-1', deleted: true },
        createdAt: '2026-07-01T00:00:00.000Z', attempts: 0, lastError: null,
        status: 'pending', nextRetryAt: null },
    ])
    // What the device sees: the getter cannot return a deleted row.
    fakeStore.getFoodLogs.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ processed: 1, errors: [] })))

    await pushMutations('u1')

    expect(fakeStore.markFoodLogSynced).toHaveBeenCalledWith('food-row-1')
    expect(fakeStore.deleteMutations).toHaveBeenCalledWith(['ob-del'])
  })

  it('still uses the read-then-upsert path for a normal (non-delete) log', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([
      { id: 'ob-add', userId: 'u1', domain: 'food_logs', date: '2026-07-01',
        payload: { id: 'food-row-2' },
        createdAt: '2026-07-01T00:00:00.000Z', attempts: 0, lastError: null,
        status: 'pending', nextRetryAt: null },
    ])
    fakeStore.getFoodLogs.mockResolvedValue([{ id: 'food-row-2', date: '2026-07-01', syncStatus: 'pending' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ processed: 1, errors: [] })))

    await pushMutations('u1')

    expect(fakeStore.markFoodLogSynced).not.toHaveBeenCalled()
    expect(fakeStore.upsertFoodLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'food-row-2', syncStatus: 'synced' }),
    )
  })
})

describe('DV-5 siblings — the same defect on every other delete-capable domain', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetSyncBackoff() })

  function outbox(domain: string, payload: Record<string, unknown>) {
    fakeStore.getPendingMutations.mockResolvedValue([
      { id: 'ob-1', userId: 'u1', domain, date: '2026-07-01', payload,
        createdAt: '2026-07-01T00:00:00.000Z', attempts: 0, lastError: null,
        status: 'pending', nextRetryAt: null },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ processed: 1, errors: [] })))
  }

  // `getInjuries` filters `deleted_at IS NULL`, so the tombstone is unreachable from the
  // read-then-upsert arm and would stay pending past every later pull.
  it('marks a deleted injury synced by id', async () => {
    outbox('injuries', { id: 'inj-1', deleted: true })
    fakeStore.getInjuries.mockResolvedValue([])
    await pushMutations('u1')
    expect(fakeStore.markInjurySynced).toHaveBeenCalledWith('inj-1')
  })

  it('still reads-then-upserts a non-deleted injury', async () => {
    outbox('injuries', { id: 'inj-2' })
    fakeStore.getInjuries.mockResolvedValue([{ id: 'inj-2', syncStatus: 'pending' }])
    await pushMutations('u1')
    expect(fakeStore.markInjurySynced).not.toHaveBeenCalled()
    expect(fakeStore.upsertInjury).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inj-2', syncStatus: 'synced' }),
    )
  })

  // Keyed on (supplementId, logDate) because that is the pair `deleteSupplementLog` writes.
  it('marks a deleted supplement log synced by its (supplementId, logDate) pair', async () => {
    outbox('supplement_logs', { supplementId: 'sup-1', logDate: '2026-07-01', deleted: true })
    fakeStore.getSupplementLogs.mockResolvedValue([])
    await pushMutations('u1')
    expect(fakeStore.markSupplementLogSynced).toHaveBeenCalledWith('sup-1', '2026-07-01')
  })

  it('still reads-then-upserts a non-deleted supplement log', async () => {
    outbox('supplement_logs', { supplementId: 'sup-2' })
    fakeStore.getSupplementLogs.mockResolvedValue([
      { id: 'sl-2', supplementId: 'sup-2', source: 'manual', syncStatus: 'pending' },
    ])
    await pushMutations('u1')
    expect(fakeStore.markSupplementLogSynced).not.toHaveBeenCalled()
    expect(fakeStore.upsertSupplementLog).toHaveBeenCalledWith(
      expect.objectContaining({ supplementId: 'sup-2', syncStatus: 'synced' }),
    )
  })

  // This domain had NO confirm arm, so both halves were stuck, not just the delete.
  it('confirms a plan-meal answer on the delete arm', async () => {
    outbox('plan_meal_answers', { planMealId: 'pm-1', logDate: '2026-07-01', deleted: true })
    await pushMutations('u1')
    expect(fakeStore.markPlanMealAnswerSynced).toHaveBeenCalledWith('pm-1', '2026-07-01')
  })

  it('confirms a plan-meal answer on the non-delete arm too', async () => {
    outbox('plan_meal_answers', { planMealId: 'pm-2', logDate: '2026-07-01' })
    await pushMutations('u1')
    expect(fakeStore.markPlanMealAnswerSynced).toHaveBeenCalledWith('pm-2', '2026-07-01')
  })

  // The outbox entry carries the date; a payload that omits logDate must still confirm.
  it('falls back to the mutation date when the payload omits logDate', async () => {
    outbox('plan_meal_answers', { planMealId: 'pm-3' })
    await pushMutations('u1')
    expect(fakeStore.markPlanMealAnswerSynced).toHaveBeenCalledWith('pm-3', '2026-07-01')
  })
})
