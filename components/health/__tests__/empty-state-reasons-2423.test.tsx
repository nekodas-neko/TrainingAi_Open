// @vitest-environment jsdom
/**
 * issue 2423 — a dash with no reason. The resilience tile and the body-battery stress strip each render
 * nothing when their metric is absent, so the reader cannot tell "nothing recorded" from "still
 * building a baseline". Each surface now says why, in the one sentence `scoreGapText` already
 * gives the three score screens (the Orchestrator's ruling: no new copy per surface).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/components/body-battery/stress-day-chart', () => ({ StressDayChart: () => null }))
vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => createElement('div', null, p.children as never) }),
  AnimatePresence: ({ children }: { children: never }) => children,
}))

import { ResilienceTile } from '../resilience-tile'
import { BodyBatteryCard } from '@/components/body-battery-card'
import { scoreGapText } from '../score-gap-copy'
import { metricAvailability } from '@/lib/health/score-availability'
import type { BodyBatteryResponse } from '@/lib/health/body-battery-day'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
async function render(node: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(node) })
  return host
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  root = null
  host = null
})

const NO_INPUT = scoreGapText([metricAvailability('resilience', null)], 'resilience')

const tile = (over: Partial<Parameters<typeof ResilienceTile>[0]> = {}) =>
  createElement(ResilienceTile, {
    level: null, band: null, confidence: null, asOf: null, unavailable: null, ...over,
  })

describe('the resilience tile says why it has no level (issue 2423)', () => {
  it('shows the availability reason when there is no level and no coverage observation', async () => {
    expect(NO_INPUT).toBe('Nothing recorded for today')
    const el = await render(tile({ gapText: NO_INPUT }))
    expect(el.textContent).toContain('Resilience')
    expect(el.textContent).toContain('Not published yet')
    expect(el.textContent).toContain('Nothing recorded for today')
  })

  it('stays silent when it has neither an observation nor a reason, as before', async () => {
    const el = await render(tile())
    expect(el.textContent).toBe('')
  })

  it('leaves the coverage line to explain itself: two reasons for one absence would contradict', async () => {
    const el = await render(tile({
      gapText: NO_INPUT,
      unavailable: { daysSeen: 7, daysMeetingCoverageGate: 2, coverageGateMinutes: 240, minValidDays: 5, modelWindowDays: 14 },
    }))
    expect(el.textContent).toContain('2 of the last 7 days')
    expect(el.textContent).not.toContain('Nothing recorded for today')
  })

  it('never adds a reason to a level it does have', async () => {
    const el = await render(tile({ level: 3.2, band: 'adequate', confidence: 1, asOf: '2026-10-07', gapText: NO_INPUT }))
    expect(el.textContent).toContain('Adequate')
    expect(el.textContent).not.toContain('Nothing recorded for today')
  })
})

const battery = (over: Partial<BodyBatteryResponse> = {}): BodyBatteryResponse => ({
  current: 60, label: 'Good', trend: 'steady', anchor: 60, anchorSource: 'readiness', anchorProvisional: false,
  charged: 4, drained: 4, wakeTime: null,
  series: [{ t: 1, v: 60 }, { t: 2, v: 60 }],
  hasData: true,
  confidence: { sufficient: true, sampleCount: 300, samplesPerHour: 30 },
  hrMax: { value: 180, source: 'observed', observedPeak: 180, peakDays: 10 },
  stress: null,
  ...over,
} as BodyBatteryResponse)

async function openCard(b: BodyBatteryResponse) {
  const el = await render(createElement(BodyBatteryCard, { battery: b }))
  await act(async () => { el.querySelector('button[aria-expanded]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  return el
}

describe('the body-battery card says why there is no stress strip (issue 2423)', () => {
  it('names the reason beside where the strip would be', async () => {
    const el = await openCard(battery({ availability: [metricAvailability('daytimeStress', null)] }))
    expect(el.textContent).toContain('Daytime stress · Nothing recorded for today')
  })

  it('says nothing when the response predates the field', async () => {
    const el = await openCard(battery())
    expect(el.textContent).not.toContain('Daytime stress ·')
  })

  it('says nothing when there is a strip', async () => {
    const el = await openCard(battery({
      stress: { current: -0.2, draining: false, extraDrained: 0, series: [{ t: 1, level: -0.2 }, { t: 2, level: -0.1 }], highMinutes: 0 },
      availability: [metricAvailability('daytimeStress', 2)],
    }))
    expect(el.textContent).not.toContain('Nothing recorded for today')
  })
})
