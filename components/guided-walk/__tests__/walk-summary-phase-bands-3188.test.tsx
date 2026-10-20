// @vitest-environment jsdom
/**
 * issue 3188 — an early-saved walk's HR chart gets bands only for the blocks walked.
 *
 * The helper and the plugin are tested on their own; this pins the wiring, that the summary hands the
 * chart bands built from the CLIPPED segments, so putting `plan.segments` back fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  chartProps: [] as { phaseBands?: { fromMin: number; toMin: number; kind: string }[] }[],
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: vi.fn(() => ({})) }))
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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
// Both dynamic components in the summary become stubs; the HR chart's is the one given `phaseBands`.
vi.mock('next/dynamic', () => ({
  default: () => (props: { phaseBands?: { fromMin: number; toMin: number; kind: string }[] }) => {
    if ('phaseBands' in props) h.chartProps.push(props)
    return null
  },
}))

import { WalkSummary } from '../walk-summary'
import type { WalkConfig } from '@/lib/walk/interval-plan'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// [slow 0-180, fast 180-360, slow 360-540, fast 540-720]
const PLAN: WalkConfig = { sets: 2, fastSec: 180, slowSec: 180, warmupSec: 0, cooldownSec: 0, treadmill: true } as WalkConfig
const STARTED = new Date('2026-10-12T02:00:00Z').getTime()
const samples = [30, 90, 150, 200, 230].map((sec, i) => ({ at: STARTED + sec * 1000, bpm: 100 + i * 5 }))

let container: HTMLDivElement
let root: Root | null = null

async function renderSummary(elapsedSec: number) {
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(WalkSummary, { config: PLAN, samples, cadence: null, elapsedSec, startedAtMs: STARTED, onDone: () => {} }))
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => {
  h.chartProps.length = 0
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

describe('walk summary phase bands (issue 3188)', () => {
  it('an early save paints no band for a block never reached and ends the current one at the stop', async () => {
    await renderSummary(240)
    const bands = h.chartProps.at(-1)?.phaseBands
    expect(bands).toEqual([
      { fromMin: 0, toMin: 3, kind: 'slow' },
      { fromMin: 3, toMin: 4, kind: 'fast' },
    ])
  })

  it('a walk walked to the end keeps all four bands', async () => {
    await renderSummary(720)
    expect(h.chartProps.at(-1)?.phaseBands).toHaveLength(4)
  })
})
