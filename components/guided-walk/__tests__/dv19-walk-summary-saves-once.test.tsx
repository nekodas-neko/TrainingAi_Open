// @vitest-environment jsdom
/**
 * DV-19 ③ (#2118) — one guided walk, one activity row, however many times its summary mounts.
 *
 * `WalkSummary` writes the walk's row on mount, and its guard was a ref: one per MOUNT. The summary
 * remounts whenever the walk route is re-entered while the walk is still `'done'` — Android Back off
 * the summary navigates away without `reset()`, and the next "Guided walk" tap lands on the summary
 * again. That mount has lost the HR samples and elapsed time (component state in
 * `GuidedWalkContent`), so its write was a second row of 0 minutes and no HR, and on the device the
 * outbox replay (last-write-wins on the server's `(user, date, start_time)` key) overwrote the real
 * walk with it.
 *
 * These mount the real component against an in-memory local store and count what lands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>()
  const mutations: Array<{ payload: { id?: string } }> = []
  const store = {
    failWrites: false,
    upsertActivityLog: async (r: Record<string, unknown>) => {
      if (store.failWrites) throw new Error('SQLite closed')
      rows.set(r.id as string, r)
    },
    queueMutation: async (m: { payload: { id?: string } }) => { mutations.push(m) },
    getActivityLogs: async () => [...rows.values()],
  }
  return { rows, mutations, store, getLocalStore: vi.fn((_userId: string) => store as unknown) }
})

vi.mock('@/lib/local-store', () => ({ getLocalStore: h.getLocalStore }))
// The push is the network half; offline it simply never calls back. The row is already local.
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pullDelta: vi.fn(async () => null) }))
vi.mock('@/lib/cache-groups', () => ({
  invalidateActivityWrites: vi.fn(async () => {}),
  invalidatePulledDomains: vi.fn(async () => {}),
}))
vi.mock('@/lib/sqlite/cache', () => ({ cachedFetch: vi.fn(async () => {}) }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/lib/view-transition', () => ({ useTransitionRouter: () => ({ prefetch: () => {}, push: () => {} }) }))
vi.mock('@/lib/shell-nav', () => ({ navigateToTab: vi.fn() }))
vi.mock('@/components/health/zone-breakdown', () => ({ ZoneBreakdown: () => null }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { WalkSummary } from '../walk-summary'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import type { WalkConfig } from '@/lib/walk/interval-plan'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAN: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: true } as WalkConfig
// Local midday, so the walk's date and clock times are one day in any zone the suite runs in.
const STARTED = new Date('2026-09-24T02:18:00Z').getTime()

let container: HTMLDivElement
let root: Root | null = null
let fetchMock: ReturnType<typeof vi.fn>

/** Mounts the summary the way `GuidedWalkContent` does for a `'done'` walk, and lets the save run. */
async function mountSummary(props: { elapsedSec: number; userId?: string }) {
  const s = useGuidedWalkStore.getState()
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(WalkSummary, {
      config: s.config, samples: [], cadence: null, elapsedSec: props.elapsedSec,
      startedAtMs: s.startedAtMs!, userId: props.userId, onDone: s.reset,
    }))
  })
  // The save is async past the effect; flush it.
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function unmountSummary() {
  await act(async () => { root?.unmount() })
  root = null
}

function finishWalk(startedAtMs = STARTED) {
  const s = useGuidedWalkStore.getState()
  s.reset()
  s.setConfig(PLAN)
  s.start(startedAtMs)
  useGuidedWalkStore.getState().finish()
}

beforeEach(() => {
  h.rows.clear()
  h.mutations.length = 0
  h.store.failWrites = false
  container = document.createElement('div')
  document.body.appendChild(container)
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ activityLog: { id: 'server-1', caloriesBurned: 120 } }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  await unmountSummary()
  container.remove()
  vi.unstubAllGlobals()
})

describe('the guided-walk summary writes one row per walk (DV-19 ③)', () => {
  it('a remount of a saved walk writes nothing — not a second row, not an overwrite', async () => {
    finishWalk()
    await mountSummary({ elapsedSec: 40 * 60, userId: 'u1' })
    expect(h.rows.size).toBe(1)
    const [first] = [...h.rows.values()]
    expect(first.durationMin).toBe(30) // capped at the 30-minute plan

    // Back off the summary, then the walk route again: the store is still 'done', the samples and
    // elapsed time are gone.
    await unmountSummary()
    await mountSummary({ elapsedSec: 0, userId: 'u1' })

    expect(h.rows.size).toBe(1)
    expect([...h.rows.values()][0].durationMin).toBe(30)
    expect(h.mutations).toHaveLength(1)
    expect(container.textContent).toContain('Saved to your activity history.')
  })

  it('the row is written under the walk’s own id, so even a second write could only upsert it', async () => {
    finishWalk()
    const walkId = useGuidedWalkStore.getState().walkId
    expect(walkId).toMatch(/^[0-9a-f-]{36}$/)
    await mountSummary({ elapsedSec: 600, userId: 'u1' })
    expect([...h.rows.keys()]).toEqual([walkId])
    expect(h.mutations[0].payload.id).toBe(walkId)
  })

  it('a new walk after a saved one gets a new row', async () => {
    finishWalk()
    await mountSummary({ elapsedSec: 600, userId: 'u1' })
    await unmountSummary()

    finishWalk(STARTED + 60 * 60 * 1000)
    await mountSummary({ elapsedSec: 900, userId: 'u1' })

    expect(h.rows.size).toBe(2)
    expect(h.mutations).toHaveLength(2)
    expect(new Set(h.mutations.map(m => m.payload.id)).size).toBe(2)
  })

  it('offline, the walk is saved locally once and queued once; nothing waits on the network', async () => {
    finishWalk()
    await mountSummary({ elapsedSec: 600, userId: 'u1' })
    await unmountSummary()
    await mountSummary({ elapsedSec: 0, userId: 'u1' })
    expect(h.rows.size).toBe(1)
    expect(h.mutations).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the web path posts once per walk too', async () => {
    finishWalk()
    await mountSummary({ elapsedSec: 600 })
    await unmountSummary()
    await mountSummary({ elapsedSec: 0 })
    const posts = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/activity-logs')
    expect(posts).toHaveLength(1)
  })

  it('a save that wrote nothing anywhere hands the claim back, so the next mount retries', async () => {
    finishWalk()
    h.store.failWrites = true
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    await mountSummary({ elapsedSec: 600, userId: 'u1' })
    expect(h.rows.size).toBe(0)
    expect(useGuidedWalkStore.getState().savedWalkId).toBeNull()

    await unmountSummary()
    h.store.failWrites = false
    await mountSummary({ elapsedSec: 600, userId: 'u1' })
    expect(h.rows.size).toBe(1)
  })
})

describe('the walk identity in the persisted store', () => {
  it('a walk rehydrated as done resets to config, identity and claim included', async () => {
    finishWalk()
    useGuidedWalkStore.getState().claimWalkSave()
    localStorage.setItem('ta_guided_walk_v1', JSON.stringify({
      version: 0, state: { ...useGuidedWalkStore.getState() },
    }))
    await useGuidedWalkStore.persist.rehydrate()
    const s = useGuidedWalkStore.getState()
    expect(s.mode).toBe('config')
    expect(s.walkId).toBeNull()
    expect(s.savedWalkId).toBeNull()
  })

  it('an active walk persisted before walkId existed still claims its save exactly once', async () => {
    useGuidedWalkStore.getState().reset()
    localStorage.setItem('ta_guided_walk_v1', JSON.stringify({
      version: 0,
      state: {
        mode: 'active', config: PLAN, customConfig: null, startedAtMs: Date.now() - 5 * 60_000,
        rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null,
      },
    }))
    await useGuidedWalkStore.persist.rehydrate()
    expect(useGuidedWalkStore.getState().mode).toBe('active')
    useGuidedWalkStore.getState().finish()

    const first = useGuidedWalkStore.getState().claimWalkSave()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(useGuidedWalkStore.getState().claimWalkSave()).toBeNull()
  })

  it('nothing can be claimed for a walk that has not finished', () => {
    const s = useGuidedWalkStore.getState()
    s.reset()
    expect(s.claimWalkSave()).toBeNull()
    s.start(Date.now())
    expect(useGuidedWalkStore.getState().claimWalkSave()).toBeNull()
  })
})
