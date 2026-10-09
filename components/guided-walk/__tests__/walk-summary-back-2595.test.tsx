// @vitest-environment jsdom
/**
 * issue 2595 — Android Back off a guided-walk summary is Done.
 *
 * Back used to navigate away with the walk still `'done'` in the store, so the next "Guided walk" tap
 * remounted a summary that had lost the HR samples and elapsed time and showed "Walk complete · 0 min".
 * Two halves: the summary answers the back gesture exactly as its Done button does, and a container
 * that finds a `'done'` walk it did not finish offers a fresh walk instead of a hollow summary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  navigateToTab: vi.fn(),
  store: {
    upsertActivityLog: async () => {},
    queueMutation: async () => {},
    getActivityLogs: async () => [],
  },
}))

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
vi.mock('@/lib/shell-nav', () => ({ navigateToTab: h.navigateToTab }))
vi.mock('@/components/health/zone-breakdown', () => ({ ZoneBreakdown: () => null }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
// The container test only needs to know WHICH screen it chose.
vi.mock('../walk-config', () => ({ WalkConfig: () => createElement('div', null, 'WALK-SETUP') }))
vi.mock('../walk-active', () => ({ WalkActive: () => createElement('div', null, 'WALK-ACTIVE') }))

import { WalkSummary } from '../walk-summary'
import { GuidedWalkContent } from '../guided-walk-content'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { requestWalkExit } from '@/lib/walk/walk-exit'
import type { WalkConfig } from '@/lib/walk/interval-plan'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAN: WalkConfig = { sets: 5, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: true } as WalkConfig
const STARTED = new Date('2026-09-24T02:18:00Z').getTime()
const PROFILE = { age: 40, restingHr: 55, hrMax: 180 }

let container: HTMLDivElement
let root: Root | null = null

function finishWalk() {
  const s = useGuidedWalkStore.getState()
  s.reset()
  s.setConfig(PLAN)
  s.start(STARTED)
  useGuidedWalkStore.getState().finish()
}

async function render(node: ReturnType<typeof createElement>) {
  root = createRoot(container)
  await act(async () => { root!.render(node) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => {
  h.navigateToTab.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  vi.unstubAllGlobals()
  useGuidedWalkStore.getState().reset()
})

describe('Back on the walk summary behaves like Done (issue 2595)', () => {
  it('the back gesture resets the walk and goes to Health, and is answered', async () => {
    finishWalk()
    const s = useGuidedWalkStore.getState()
    await render(createElement(WalkSummary, {
      config: s.config, samples: [], cadence: null, elapsedSec: 600,
      startedAtMs: s.startedAtMs!, onDone: s.reset,
    }))
    expect(useGuidedWalkStore.getState().mode).toBe('done')

    let answered = false
    await act(async () => { answered = requestWalkExit() })

    expect(answered).toBe(true) // MobileAuthHandler must not also navigate back
    expect(useGuidedWalkStore.getState().mode).toBe('config')
    expect(useGuidedWalkStore.getState().startedAtMs).toBeNull()
    expect(h.navigateToTab).toHaveBeenCalledTimes(1)
    expect(h.navigateToTab.mock.calls[0][1]).toBe('/health')
  })

  it('once the summary is gone the back gesture is not claimed', async () => {
    finishWalk()
    const s = useGuidedWalkStore.getState()
    await render(createElement(WalkSummary, {
      config: s.config, samples: [], cadence: null, elapsedSec: 600,
      startedAtMs: s.startedAtMs!, onDone: s.reset,
    }))
    await act(async () => { root!.unmount() })
    root = null
    expect(requestWalkExit()).toBe(false)
  })
})

describe('a summary this mount did not finish is never shown (issue 2595)', () => {
  it('Guided walk after leaving a done walk opens the setup screen, not a 0-minute summary', async () => {
    finishWalk() // the walk is still 'done' in the store, as after leaving by any route but Done
    await render(createElement(GuidedWalkContent, { profile: PROFILE }))

    expect(container.textContent).toContain('WALK-SETUP')
    expect(container.textContent).not.toContain('Walk complete')
    expect(useGuidedWalkStore.getState().mode).toBe('config')
  })
})
