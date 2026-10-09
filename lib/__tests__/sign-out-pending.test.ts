// @vitest-environment jsdom
// Issue 2532 — counting what a sign-out would discard unsynced, and syncing before it asks.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { byDomain, push, flush, reach, store } = vi.hoisted(() => ({
  byDomain: { current: {} as Record<string, number> },
  push: vi.fn(async (_u: string): Promise<{ pushed: number } | null> => ({ pushed: 0 })),
  flush: vi.fn(async () => {}),
  reach: { ok: true },
  store: { throws: false },
}))
vi.mock('@/lib/local-store', () => ({
  getLocalStore: () => {
    if (store.throws) throw new Error('boom')
    return { countQueuedMutationsByDomain: async () => ({ ...byDomain.current }) }
  },
}))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: (u: string) => push(u) }))
vi.mock('@/lib/activity/detection-events', () => ({ flushDetectionEvents: () => flush() }))
vi.mock('@/lib/sqlite/cache', () => ({ requestsCompleting: () => reach.ok }))

import { useWorkoutStore } from '@/lib/stores/workout-store'
import {
  countUnsentChanges, describeUnsentChanges, syncBeforeSignOut, prepareSignOut, UPLOAD_QUEUE_KEYS,
} from '@/lib/sign-out-pending'

const active = (extra: Record<string, unknown> = {}) =>
  useWorkoutStore.setState({ workoutStartMs: Date.now() - 60_000, workoutEndMs: null, mode: 'pre', ...extra } as never)

beforeEach(() => {
  localStorage.clear()
  byDomain.current = {}
  reach.ok = true
  store.throws = false
  push.mockReset(); push.mockResolvedValue({ pushed: 0 })
  flush.mockReset(); flush.mockResolvedValue(undefined)
  useWorkoutStore.setState(useWorkoutStore.getInitialState(), true)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('countUnsentChanges', () => {
  it('is all zeros on a clean device', async () => {
    const u = await countUnsentChanges('u1')
    expect(u.total).toBe(0)
    expect(u.activeWorkout).toEqual({ active: false, loggedSets: 0 })
    expect(describeUnsentChanges(u)).toEqual([])
  })

  it('counts outbox rows by domain', async () => {
    byDomain.current = { food_logs: 2, body_metrics: 1, workout_log: 3 }
    const u = await countUnsentChanges('u1')
    expect(u.outbox).toEqual({ count: 6, byDomain: { food_logs: 2, body_metrics: 1, workout_log: 3 } })
    expect(u.total).toBe(6)
  })

  it('counts logged sets in a running workout, not an empty or finished one', async () => {
    active({ setWeights: [100, 100], sessionLog: [{ name: 'Bench', setWeights: [80, 80, 80], reps: [8, 8, 8] }] })
    expect((await countUnsentChanges('u1')).activeWorkout).toEqual({ active: true, loggedSets: 5 })

    useWorkoutStore.setState(useWorkoutStore.getInitialState(), true)
    active()
    expect((await countUnsentChanges('u1')).activeWorkout).toEqual({ active: true, loggedSets: 0 })

    active({ workoutEndMs: Date.now(), setWeights: [1], sessionLog: [{ name: 'x', setWeights: [1], reps: [1] }] })
    expect((await countUnsentChanges('u1')).activeWorkout).toEqual({ active: false, loggedSets: 0 })
  })

  it('counts stashed superset buffers other than the current exercise', async () => {
    active({
      currentIdx: 0, setWeights: [50],
      exerciseBuffers: { 1: { setWeights: [60, 60] }, 0: { setWeights: [99] } } as never,
    })
    expect((await countUnsentChanges('u1')).activeWorkout.loggedSets).toBe(3)
  })

  it('counts unsynced preference names', async () => {
    localStorage.setItem('ta_prefs_unsynced', JSON.stringify(['foodRegion', 'restDuration']))
    expect((await countUnsentChanges('u1')).prefsUnsynced).toBe(2)
  })

  it('counts each upload queue and omits empty ones', async () => {
    localStorage.setItem('detection-events-outbox', '[{},{}]')
    localStorage.setItem('ta-cadence-captures', '[{}]')
    localStorage.setItem('ta-oura-ble-pending-live-steps', '[{},{},{}]')
    localStorage.setItem('ta-oura-ble-pending-live-steps-auto', '[{}]')
    localStorage.setItem('ta-oura-ble-pending-accel-chunks', '[{},{}]')
    const u = await countUnsentChanges('u1')
    expect(u.uploadQueues).toEqual({
      'detection-events-outbox': 2, 'ta-cadence-captures': 1, 'ta-oura-ble-pending-live-steps': 3,
      'ta-oura-ble-pending-live-steps-auto': 1, 'ta-oura-ble-pending-accel-chunks': 2,
    })
    expect(u.total).toBe(9)
    expect(Object.keys(u.uploadQueues).sort()).toEqual([...UPLOAD_QUEUE_KEYS].sort())
  })

  it('tolerates malformed and non-array values without throwing', async () => {
    for (const k of UPLOAD_QUEUE_KEYS) localStorage.setItem(k, '{not json')
    localStorage.setItem('ta_prefs_unsynced', '"a string"')
    localStorage.setItem('detection-events-outbox', '{"a":1}')
    const u = await countUnsentChanges('u1')
    expect(u.total).toBe(0)
  })

  it('still counts the browser-side sources when the local store throws', async () => {
    store.throws = true
    localStorage.setItem('ta_prefs_unsynced', '["a"]')
    expect((await countUnsentChanges('u1')).total).toBe(1)
  })
})

describe('describeUnsentChanges', () => {
  it('writes plain-words lines and a matching total', async () => {
    active({ setWeights: [1, 1, 1] })
    byDomain.current = { food_logs: 1, body_metrics: 1, workout_log: 1, sleep_session: 2 }
    localStorage.setItem('ta_prefs_unsynced', '["a"]')
    localStorage.setItem('ta-cadence-captures', '[{},{}]')
    const u = await countUnsentChanges('u1')
    const lines = describeUnsentChanges(u)
    expect(lines.map(l => l.label)).toEqual([
      '3 workout sets in progress', '2 food/body log changes', '1 workout or activity change',
      '2 sleep or ring changes', '1 setting change', '2 sensor uploads',
    ])
    expect(lines.reduce((a, l) => a + l.count, 0)).toBe(u.total)
  })
})

describe('syncBeforeSignOut', () => {
  it('reports synced when the push empties the outbox', async () => {
    byDomain.current = { food_logs: 2 }
    push.mockImplementation(async () => { byDomain.current = {}; return { pushed: 2 } })
    const r = await syncBeforeSignOut('u1')
    expect(r.outcome).toBe('synced')
    expect(r.remaining.total).toBe(0)
    expect(push).toHaveBeenCalledWith('u1')
    expect(flush).toHaveBeenCalled()
  })

  it('reports partial when some changes remain', async () => {
    byDomain.current = { food_logs: 3 }
    push.mockImplementation(async () => { byDomain.current = { food_logs: 1 }; return { pushed: 2 } })
    const r = await syncBeforeSignOut('u1')
    expect(r.outcome).toBe('partial')
    expect(r.remaining.outbox.count).toBe(1)
  })

  it('a push that throws is a partial, not an exception', async () => {
    byDomain.current = { food_logs: 1 }
    push.mockRejectedValue(new Error('network'))
    const r = await syncBeforeSignOut('u1')
    expect(r.outcome).toBe('partial')
  })

  it('returns offline at once without pushing, when the radio is off', async () => {
    byDomain.current = { food_logs: 1 }
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const r = await syncBeforeSignOut('u1')
    expect(r.outcome).toBe('offline')
    expect(r.remaining.total).toBe(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('returns offline when requests are not completing (low reception)', async () => {
    reach.ok = false
    expect((await syncBeforeSignOut('u1')).outcome).toBe('offline')
    expect(push).not.toHaveBeenCalled()
  })

  it('does not hang on a push that never resolves', async () => {
    byDomain.current = { food_logs: 1 }
    push.mockReturnValue(new Promise(() => {}))
    vi.useFakeTimers()
    const p = syncBeforeSignOut('u1', { timeoutMs: 10_000 })
    await vi.advanceTimersByTimeAsync(10_000)
    const r = await p
    expect(r.outcome).toBe('timeout')
    expect(r.remaining.total).toBe(1)
  })
})

describe('sign-out itself is unchanged', () => {
  it('signOutAndClearDevice does not depend on this module, so "Sign out anyway" clears exactly as before', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'sign-out.ts'), 'utf8')
    expect(src).not.toContain('sign-out-pending')
    // Nothing is kept across a sign-out: the sequence still ends in the all-but-device-settings clear.
    expect(src).toContain('await clearLocalStoreData()')
    expect(src).toContain('clearAccountStorage()')
  })
})

describe('prepareSignOut', () => {
  it('syncs, recounts and lists what would be lost', async () => {
    byDomain.current = { body_metrics: 2 }
    localStorage.setItem('ta_prefs_unsynced', '["a"]')
    const r = await prepareSignOut('u1')
    expect(r.remaining.total).toBe(3)
    expect(r.lost.map(l => l.label)).toEqual(['2 food/body log changes', '1 setting change'])
  })

  it('has nothing to warn about when everything synced', async () => {
    const r = await prepareSignOut('u1')
    expect(r.outcome).toBe('synced')
    expect(r.lost).toEqual([])
  })

  it('changes no data: counting and syncing leave storage as found', async () => {
    localStorage.setItem('ta-cadence-captures', '[{}]')
    localStorage.setItem('ta_prefs_unsynced', '["a"]')
    active({ setWeights: [1] })
    await prepareSignOut('u1')
    expect(localStorage.getItem('ta-cadence-captures')).toBe('[{}]')
    expect(localStorage.getItem('ta_prefs_unsynced')).toBe('["a"]')
    expect(useWorkoutStore.getState().setWeights).toEqual([1])
  })
})
