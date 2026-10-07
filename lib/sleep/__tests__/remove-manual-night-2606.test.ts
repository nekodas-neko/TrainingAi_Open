// Issue 2606 — the one client write that removes a hand-entered night: local tombstone + queued
// `{ id, deleted: true }` in the same turn on the device, the DELETE route on the web build, and the
// named invalidation group either way. Nothing is queued for a night the store will not remove.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => ({
  current: null as null | {
    removeManualSleepLocally: ReturnType<typeof vi.fn>
    queueMutation: ReturnType<typeof vi.fn>
  },
}))
const push = vi.hoisted(() => vi.fn(async () => ({ pushed: 1 })))
const invalidate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => store.current }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: push }))
vi.mock('@/lib/cache-groups', () => ({ invalidateManualSleepWrite: invalidate }))

import { removeManualNight } from '../save-manual-night'

const ID = '6f1c2a4e-0b7d-4c1e-9a55-2606aa0000d1'

beforeEach(() => { push.mockClear(); invalidate.mockClear() })
afterEach(() => { vi.unstubAllGlobals(); store.current = null })

describe('removeManualNight', () => {
  it('on the device: tombstones the local row, queues the removal under the night\'s date, pushes, invalidates', async () => {
    store.current = { removeManualSleepLocally: vi.fn(async () => '2026-10-07'), queueMutation: vi.fn(async () => {}) }
    expect(await removeManualNight({ userId: 'u', id: ID })).toEqual({ ok: true })
    expect(store.current.removeManualSleepLocally).toHaveBeenCalledWith(ID)
    expect(store.current.queueMutation).toHaveBeenCalledWith({
      userId: 'u', domain: 'manual_sleep', date: '2026-10-07', payload: { id: ID, deleted: true },
    })
    // The local mark lands before the queue entry, so no read in between can show the night.
    expect(store.current.removeManualSleepLocally.mock.invocationCallOrder[0])
      .toBeLessThan(store.current.queueMutation.mock.invocationCallOrder[0])
    expect(push).toHaveBeenCalledWith('u')
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('queues nothing when the store will not remove it (a device night, an unknown id)', async () => {
    store.current = { removeManualSleepLocally: vi.fn(async () => null), queueMutation: vi.fn() }
    expect(await removeManualNight({ userId: 'u', id: ID })).toEqual({ ok: false, reason: 'Only a night you entered can be removed' })
    expect(store.current.queueMutation).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refuses a malformed id before touching anything', async () => {
    store.current = { removeManualSleepLocally: vi.fn(), queueMutation: vi.fn() }
    expect((await removeManualNight({ userId: 'u', id: 'ring-1' })).ok).toBe(false)
    expect(store.current.removeManualSleepLocally).not.toHaveBeenCalled()
  })

  it('without a local store (web build): calls DELETE on the route and invalidates', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ ok: true, removed: true, alreadyRemoved: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await removeManualNight({ userId: 'u', id: ID })).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/sleep-sessions/manual')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(String(init.body))).toEqual({ id: ID })
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('surfaces the route\'s refusal without invalidating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Only a night you entered can be removed' }), { status: 409 })))
    expect(await removeManualNight({ userId: 'u', id: ID })).toEqual({ ok: false, reason: 'Only a night you entered can be removed' })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
