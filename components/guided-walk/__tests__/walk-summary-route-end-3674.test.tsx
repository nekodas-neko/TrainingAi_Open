// @vitest-environment jsdom
/**
 * #3674: a guided walk whose planned end passes with the phone locked. The 1 Hz finish tick does not
 * run, the GPS watcher keeps recording, and the walk home used to land in the saved distance and
 * pace against the walk's own duration. The summary keeps only the fixes up to the walk's end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>()
  const mutations: Array<{ payload: Record<string, unknown> }> = []
  const store = {
    upsertActivityLog: async (r: Record<string, unknown>) => { rows.set(r.id as string, r) },
    queueMutation: async (m: { payload: Record<string, unknown> }) => { mutations.push(m) },
    getActivityLogs: async () => [...rows.values()],
  }
  return { rows, mutations, store }
})

vi.mock('@/lib/local-store', () => ({ getLocalStore: vi.fn(() => h.store as unknown) }))
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
import { haversineDistanceKm } from '@trainingai/shared/activity/route-metrics'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 60 s warm-up and one fast + one slow block of 120 s: 300 s planned. Outdoors, so GPS is used.
const PLAN: WalkConfig = { sets: 1, fastSec: 120, slowSec: 120, warmupSec: 60, cooldownSec: 0, treadmill: false } as WalkConfig
// Local midday Brisbane, far from any date edge.
const STARTED = new Date('2026-09-24T02:00:00Z').getTime()
const PLANNED_SEC = 300
const north = (metres: number) => -27.47 + metres / 111_195

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  h.rows.clear(); h.mutations.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  vi.unstubAllGlobals()
})

describe('walk summary clips the route at the walk end (#3674)', () => {
  it('saves the distance and pace of the walk, not of the walk home', async () => {
    const s = useGuidedWalkStore.getState()
    s.reset(); s.setConfig(PLAN); s.start(STARTED)
    // 5 m every 5 s for the planned 300 s, then the same for another 10 minutes before the unlock.
    for (let sec = 5; sec <= PLANNED_SEC + 600; sec += 5) {
      useGuidedWalkStore.getState().appendPoint({ lat: north(sec), lng: 153.02, t: STARTED + sec * 1000 })
    }
    useGuidedWalkStore.getState().finish()
    const all = useGuidedWalkStore.getState().rawPoints
    const walked = all.filter(p => p.t <= STARTED + PLANNED_SEC * 1000)
    expect(all.length).toBeGreaterThan(walked.length)

    root = createRoot(container)
    await act(async () => {
      // The finish only ran at unlock, so the elapsed time is past the plan.
      root!.render(createElement(WalkSummary, {
        config: PLAN, samples: [], cadence: null, elapsedSec: PLANNED_SEC + 600, startedAtMs: STARTED, userId: 'u1', onDone: s.reset,
      }))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const row = [...h.rows.values()][0]
    const km = haversineDistanceKm(walked[0], walked.at(-1)!)
    expect(row.distanceKm).toBeCloseTo(Math.round(km * 100) / 100, 5)
    expect(row.distanceKm as number).toBeLessThan(0.4)
    expect(h.mutations[0].payload.distanceKm).toBe(row.distanceKm)
  })
})
