// @vitest-environment jsdom
/**
 * Issue 2242 (LA-48): the walk summary's save carries the live pacer tally on each segment, in both
 * the local row and the outbox payload, and omits it for a walk that had none.
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
vi.mock('@/lib/activity/link-prescribed-run', () => ({ linkPrescribedRun: vi.fn(async () => {}) }))
vi.mock('@/components/health/zone-breakdown', () => ({ ZoneBreakdown: () => null }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { WalkSummary } from '../walk-summary'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import type { WalkConfig } from '@/lib/walk/interval-plan'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// warm-up 60 s, then fast 0 (index 1), slow (index 2)...: segment indexes come from the plan.
const PLAN: WalkConfig = { sets: 2, fastSec: 180, slowSec: 180, warmupSec: 60, cooldownSec: 0, treadmill: true } as WalkConfig
const STARTED = new Date('2026-09-24T02:18:00Z').getTime()

let container: HTMLDivElement
let root: Root | null = null

async function saveWalk(withTally: boolean) {
  const s = useGuidedWalkStore.getState()
  s.reset(); s.setConfig(PLAN); s.start(STARTED)
  if (withTally) {
    for (let i = 0; i < 3; i++) s.recordPacerTick(1, 'cadence', 'green', 1000 * (100 + i))
    s.recordPacerTick(1, 'cadence', 'red', 1000 * 103)
  }
  useGuidedWalkStore.getState().finish()
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(WalkSummary, {
      config: PLAN, samples: [], cadence: null, elapsedSec: 600, startedAtMs: STARTED, userId: 'u1', onDone: s.reset,
    }))
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

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

type Seg = { index: number; pacerSignal?: string; pacerAdherence?: number; pacerTicks?: unknown }

describe('walk save carries the pacer tally (issue 2242)', () => {
  it('writes the fields on the judged segment, locally and to the outbox, and they survive the schema and a JSON round trip', async () => {
    await saveWalk(true)
    const row = [...h.rows.values()][0]
    const local = row.segments as Seg[]
    expect(local[1]).toMatchObject({ pacerSignal: 'cadence', pacerAdherence: 0.75, pacerTicks: { green: 3, amber: 0, red: 1, stopped: 0 } })
    expect('pacerAdherence' in local[0]).toBe(false)

    const wire = h.mutations[0].payload.segments as Seg[]
    expect(wire[1].pacerAdherence).toBe(0.75)

    // The local store keeps segments as JSON text.
    const roundTripped = JSON.parse(JSON.stringify(local)) as Seg[]
    expect(roundTripped[1].pacerTicks).toEqual({ green: 3, amber: 0, red: 1, stopped: 0 })

    const parsed = ActivityLogBody.safeParse({ date: '2026-09-24', ...h.mutations[0].payload })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect((parsed.data!.segments as Seg[])[1].pacerAdherence).toBe(0.75)
  })

  it('omits the fields entirely for a walk the pacer never judged', async () => {
    await saveWalk(false)
    const local = [...h.rows.values()][0].segments as Seg[]
    expect(local.length).toBeGreaterThan(1)
    expect(local.every(s => !('pacerAdherence' in s) && !('pacerSignal' in s) && !('pacerTicks' in s))).toBe(true)
  })
})
