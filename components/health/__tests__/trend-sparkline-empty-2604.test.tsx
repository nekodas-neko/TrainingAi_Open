// @vitest-environment jsdom
/**
 * Issue 2604 — the HR Recovery card vanished when no chest strap was worn in 14 days.
 *
 * `TrendSparkline` returns null when every day is null. Since ring-only days became gaps for this
 * metric, a fortnight without the strap emptied the whole card, which reads as a layout fault. A card
 * can now opt in to saying what is missing; every other sparkline still draws nothing when it has
 * nothing, so a metric every user has does not grow a card full of apology.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('react-chartjs-2', () => ({ Line: () => createElement('canvas', { 'data-testid': 'line' }) }))
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, PointElement: {}, LineElement: {}, Tooltip: {}, Filler: {},
}))
vi.mock('../detail-hero', () => ({ useHeroColorScheme: () => 'dark' }))

import { TrendSparkline } from '../trend-sparkline'
import { trendSparklinePropsEqual } from '../trend-sparkline-equal'
import type { HealthTrendDay } from '@/app/api/health/trends/route'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EMPTY = 'No chest-strap workouts in the last 14 days. Recovery is measured from the strap.'
const day = (date: string, hrr1Bpm: number | null) => ({ date, hrr1Bpm }) as unknown as HealthTrendDay
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03']

let root: Root | null = null
let host: HTMLDivElement | null = null
async function render(props: Partial<Parameters<typeof TrendSparkline>[0]> & { trends: HealthTrendDay[] }) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(TrendSparkline, {
      field: 'hrr1Bpm', label: 'HR Recovery (60s drop)', color: 'var(--color-brand)', unit: 'bpm/min', ...props,
    }))
  })
  return host
}
afterEach(async () => {
  await act(async () => { root?.unmount() })
  host?.remove()
  root = null
  host = null
})

describe('the HR Recovery card with no strap days (issue 2604)', () => {
  it('keeps the card and says why when every day is null', async () => {
    const el = await render({ trends: DAYS.map(d => day(d, null)), emptyText: EMPTY })
    expect(el.textContent).toContain('HR Recovery (60s drop) — 14 days')
    expect(el.textContent).toContain(EMPTY)
    expect(el.querySelector('[data-testid="line"]')).toBeNull()
  })

  it('draws the sparkline as before when there are strap days, and no empty line', async () => {
    const el = await render({ trends: [day(DAYS[0], null), day(DAYS[1], 24), day(DAYS[2], 27)], emptyText: EMPTY })
    expect(el.querySelector('[data-testid="line"]')).not.toBeNull()
    expect(el.textContent).not.toContain(EMPTY)
  })

  it('a card that did not opt in still renders nothing when empty', async () => {
    const el = await render({ trends: DAYS.map(d => day(d, null)) })
    expect(el.textContent).toBe('')
  })

  it('renders nothing for an empty trends list rather than a card about no data at all', async () => {
    const el = await render({ trends: [], emptyText: EMPTY })
    expect(el.textContent).toBe('')
  })

  it('the memo comparator redraws when the empty text changes', () => {
    const base = { trends: DAYS.map(d => day(d, null)), field: 'hrr1Bpm' as const, label: 'x', color: 'var(--color-brand)' }
    expect(trendSparklinePropsEqual({ ...base, emptyText: 'a' }, { ...base, emptyText: 'a' })).toBe(true)
    expect(trendSparklinePropsEqual({ ...base, emptyText: 'a' }, { ...base, emptyText: 'b' })).toBe(false)
  })
})
