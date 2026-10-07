// #2338 — the one client write for a hand-entered night: local row + queued mutation in the same turn
// on the device, the route on the web build, and the named invalidation group either way.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store = vi.hoisted(() => ({
  current: null as null | {
    upsertManualSleepLocally: ReturnType<typeof vi.fn>
    queueMutation: ReturnType<typeof vi.fn>
    getSleepSessions: ReturnType<typeof vi.fn>
  },
}))
const push = vi.hoisted(() => vi.fn(async () => ({ pushed: 1 })))
const invalidate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => store.current }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: push }))
vi.mock('@/lib/cache-groups', () => ({ invalidateManualSleepWrite: invalidate }))

import { saveManualNight } from '../save-manual-night'

const TZ = 'Australia/Brisbane'
const BED = '2026-10-06T12:30:00.000Z'
const WAKE = '2026-10-06T20:30:00.000Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T02:00:00.000Z'))
  push.mockClear(); invalidate.mockClear()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); store.current = null })

describe('saveManualNight', () => {
  it('on the device: writes the local row, queues the mutation with the id the store used, pushes, invalidates', async () => {
    store.current = {
      upsertManualSleepLocally: vi.fn(async () => 'existing-id'),
      queueMutation: vi.fn(async () => {}),
      getSleepSessions: vi.fn(async () => [{ id: 'existing-id' }]),
    }
    const res = await saveManualNight({ userId: 'u', tz: TZ, sleepStart: BED, sleepEnd: WAKE })
    expect(res).toEqual({ ok: true, date: '2026-10-07', shadowed: false })
    expect(store.current.upsertManualSleepLocally).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-10-07', sleepStart: BED, sleepEnd: WAKE, durationHours: 8, timeInBedHours: 8,
    }))
    expect(store.current.queueMutation).toHaveBeenCalledWith({
      userId: 'u', domain: 'manual_sleep', date: '2026-10-07',
      payload: { id: 'existing-id', sleepStart: BED, sleepEnd: WAKE },
    })
    expect(push).toHaveBeenCalledWith('u')
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('reports shadowed when the store read ranks a device night above it', async () => {
    store.current = {
      upsertManualSleepLocally: vi.fn(async () => 'mine'),
      queueMutation: vi.fn(async () => {}),
      getSleepSessions: vi.fn(async () => [{ id: 'ring-night' }]),
    }
    expect(await saveManualNight({ userId: 'u', tz: TZ, sleepStart: BED, sleepEnd: WAKE })).toMatchObject({ ok: true, shadowed: true })
  })

  it('refuses an implausible night before writing anything', async () => {
    store.current = { upsertManualSleepLocally: vi.fn(), queueMutation: vi.fn(), getSleepSessions: vi.fn() }
    const res = await saveManualNight({ userId: 'u', tz: TZ, sleepStart: WAKE, sleepEnd: BED })
    expect(res.ok).toBe(false)
    expect(store.current.upsertManualSleepLocally).not.toHaveBeenCalled()
    expect(store.current.queueMutation).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('without a local store (web build): posts to the route and invalidates', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'x', date: '2026-10-07', shadowed: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await saveManualNight({ userId: 'u', tz: TZ, sleepStart: BED, sleepEnd: WAKE })
    expect(res).toEqual({ ok: true, date: '2026-10-07', shadowed: false })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sleep-sessions/manual')
    expect(JSON.parse(String(init.body))).toMatchObject({ sleepStart: BED, sleepEnd: WAKE })
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('surfaces the route\'s refusal without invalidating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })))
    expect(await saveManualNight({ userId: 'u', tz: TZ, sleepStart: BED, sleepEnd: WAKE })).toEqual({ ok: false, reason: 'Too many requests' })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
