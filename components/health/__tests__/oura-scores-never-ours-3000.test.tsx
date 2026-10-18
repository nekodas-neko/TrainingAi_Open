// @vitest-environment jsdom
/**
 * issue 3000 (scoring doc rule 5): Oura's readiness is not our readiness.
 *
 * - The detail screen's cold open (no cached payload) seeds from our own scores mirrored on the
 *   device (`oura_daily_derived`), never from the `oura_daily` mirror, whose scores are Oura's.
 * - The breakdown always shows our composite, even for a payload cached before `ouraScore` was
 *   dropped — it used to show Oura's readiness as the "Baseline" with ours as an adjustment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const TODAY = '2026-10-17'
const h = vi.hoisted(() => ({
  ouraMirror: [] as Array<Record<string, unknown>>,
  derived: [] as Array<Record<string, unknown>>,
  ouraMirrorReads: 0,
}))

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/health/detail-hero', () => ({
  DetailHero: ({ children }: { children: unknown }) => createElement('div', null, children as never),
  usePageGradient: () => '',
  useHeroColorScheme: () => 'dark',
}))
vi.mock('@/components/health/trend-sparkline-lazy', () => ({ TrendSparkline: () => null }))
vi.mock('@/components/health/resilience-tile', () => ({ ResilienceTile: () => null }))
vi.mock('@/lib/hooks/use-count-up', () => ({ useCountUp: (v: number | null) => v }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/lib/hooks/use-invalidation-refetch', () => ({ useInvalidationRefetch: () => {} }))
vi.mock('@/lib/sqlite/cache', () => ({
  readTodayCacheSync: () => null,
  cachedFetchToday: async () => {},
}))
vi.mock('@/lib/local-store', () => ({
  getLocalStore: () => ({
    getOuraDaily: async () => { h.ouraMirrorReads++; return h.ouraMirror },
    getOuraDailyDerived: async () => h.derived,
  }),
}))
vi.mock('@trainingai/shared/date-utils', async orig => ({
  ...(await orig<typeof import('@trainingai/shared/date-utils')>()),
  todayInTz: () => TODAY,
}))

import { HealthScoreDetail } from '../health-score-detail'
import { ReadinessBreakdown } from '../readiness-breakdown'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | null = null

async function render(el: ReturnType<typeof createElement>) {
  root = createRoot(container)
  await act(async () => { root!.render(el) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

const detail = (scoreField: 'readinessDisplayScore' | 'sleepScore' | 'activityScore') =>
  createElement(HealthScoreDetail, {
    userId: 'user-1', theme: 'readiness', title: 'Readiness', aiSection: 'readiness',
    scoreField, trendField: 'readinessScore', contributorsField: 'readinessContributors',
    sparklineColor: 'currentColor', contributorsTitle: 'Contributors',
  })
const heroNumber = () => container.querySelector('.text-4xl')?.textContent

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  h.ouraMirror = [{ day: TODAY, readinessScore: 91, sleepScore: 87, activityScore: 83, contributors: { hrv_balance: 13 } }]
  h.derived = []
  h.ouraMirrorReads = 0
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  container.remove()
})

describe("the detail screen's cold open never paints Oura's scores (issue 3000)", () => {
  for (const field of ['readinessDisplayScore', 'sleepScore', 'activityScore'] as const) {
    it(`${field}: Oura's score mirrored, ours not → no score, never Oura's`, async () => {
      await render(detail(field))
      expect(container.textContent).not.toMatch(/\b(91|87|83)\b/)
      expect(h.ouraMirrorReads).toBe(0)
    })
  }

  it('paints our mirrored scores', async () => {
    h.derived = [{ day: TODAY, readinessScore: 55, readinessSource: 'ble-derived', sleepScore: 64, activityScore: 40 }]
    await render(detail('readinessDisplayScore'))
    expect(heroNumber()).toBe('55')
    expect(container.textContent).toContain('Computed by the app')
  })
})

describe('the readiness breakdown is always our composite (issue 3000)', () => {
  it("ignores a legacy cached ouraScore and never shows Oura's readiness as the baseline", async () => {
    const legacy = {
      readinessDisplayScore: 60, ouraScore: 91, source: 'oura+acwr',
      readinessCompositeContributors: null, temperatureDeviation: null, limited: false, inputsMissing: [],
    } as unknown as ReadinessScoreResponse
    await render(createElement(ReadinessBreakdown, { readiness: legacy }))
    expect(container.textContent).toContain('What goes into this score')
    expect(container.textContent).not.toContain('Baseline')
    expect(container.textContent).not.toContain('91')
  })
})
