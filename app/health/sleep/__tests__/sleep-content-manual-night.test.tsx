// @vitest-environment jsdom
/**
 * Issue 2338 — the Sleep screen decides when the "log last night" card exists, and what a typed
 * night does to the cards beside it. Mounts the real `SleepContent` with the score hero and the
 * data reads stubbed:
 *
 * - a device night for last night -> no card, and the bedtime card stays (today's screen, unchanged);
 * - no night for last night       -> the entry card;
 * - a night logged by hand        -> the card with Edit and Remove, and NO bedtime-adjust card and
 *   no stage card (nothing measured it);
 * - a removal still in the outbox hides the night even though the server reply still holds it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const TODAY = '2026-10-08'
const h = vi.hoisted(() => ({
  serverRows: [] as Array<Record<string, unknown>>,
  queued: [] as Array<{ domain: string; payload: Record<string, unknown> }>,
  localRows: [] as Array<Record<string, unknown>>,
  store: null as unknown,
}))

vi.mock('@/components/health/health-score-detail', () => ({
  HealthScoreDetail: (p: { leadCard: unknown; extraCards: (d: unknown, c: string, t: unknown) => unknown }) =>
    createElement('div', null, p.leadCard as never, p.extraCards({ sleepScore: null }, '', undefined) as never),
}))
vi.mock('@/components/health/sleep/manual-bedtime-card', () => ({ ManualBedtimeCard: () => createElement('div', { 'data-testid': 'bedtime-card' }) }))
vi.mock('@/components/health/provisional-badge', () => ({ ProvisionalBadge: () => null }))
vi.mock('@/components/health/body-cards/sleep-coverage-note', () => ({ sleepCoverageNote: () => null }))
vi.mock('@/components/health/hypnogram', () => ({ Hypnogram: () => null }))
vi.mock('@/components/health/trend-sparkline-lazy', () => ({ TrendSparkline: () => null }))
vi.mock('@/components/health/sleep-trend-toggle-card-lazy', () => ({ SleepTrendToggleCard: () => null }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/lib/hooks/use-invalidation-refetch', () => ({ useInvalidationRefetch: () => {} }))
vi.mock('@/lib/sleep/save-manual-night', () => ({ saveManualNight: vi.fn(), removeManualNight: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))
vi.mock('@/lib/sqlite/cache', () => ({
  readCacheSync: () => null,
  cachedFetch: async (_k: string, _u: string, _t: number, cb: (rows: unknown) => void) => { cb(h.serverRows) },
}))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => h.store }))
vi.mock('@trainingai/shared/date-utils', async orig => ({
  ...(await orig<typeof import('@trainingai/shared/date-utils')>()),
  todayInTz: () => TODAY,
}))

import { SleepContent } from '../sleep-content'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  date: TODAY, sleepPhase5Min: null, sleepStart: '2026-10-07T13:10:00.000Z', sleepEnd: '2026-10-07T20:40:00.000Z',
  deepSleepHours: null, remSleepHours: null, lightSleepHours: null, awakHours: null, ...over,
})
const DEVICE = row({ id: 'd1', manualEntry: false, sleepPhase5Min: '1122', deepSleepHours: 1, ouraId: 'x' })
const TYPED = row({ id: '3f2b1c0e-5a4d-4c3b-8a2f-1d0e9c8b7a65', manualEntry: true })

let container: HTMLDivElement
let root: Root | null = null

async function mount() {
  root = createRoot(container)
  await act(async () => { root!.render(createElement(SleepContent, { userId: 'user-1' })) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}
const card = () => container.querySelector('[data-testid="manual-night-card"]')

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  h.serverRows = []
  h.queued = []
  h.localRows = []
  h.store = null
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  container.remove()
  document.body.innerHTML = ''
})

describe('Sleep screen — log last night by hand (issue 2338)', () => {
  it('shows no card when a device recorded last night, and keeps the bedtime card', async () => {
    h.serverRows = [DEVICE]
    await mount()
    expect(card()).toBeNull()
    expect(container.querySelector('[data-testid="bedtime-card"]')).not.toBeNull()
    expect(container.textContent).toContain('Sleep Stages')
  })

  it('shows the entry card when there is no night for last night', async () => {
    h.serverRows = []
    await mount()
    expect(card()).not.toBeNull()
    expect(container.textContent).toContain('No night recorded')
  })

  it('shows the entry card when the newest night is from an earlier date', async () => {
    h.serverRows = [{ ...DEVICE, date: '2026-10-06' }]
    await mount()
    expect(container.textContent).toContain('No night recorded')
  })

  it('shows a typed night with Edit and Remove, and hides the bedtime and stage cards', async () => {
    h.serverRows = [TYPED]
    await mount()
    expect(container.textContent).toContain('Logged by hand')
    expect(container.textContent).toContain('23:10 – 06:40')
    expect([...container.querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['Edit', 'Remove night']))
    expect(container.querySelector('[data-testid="bedtime-card"]')).toBeNull()
    expect(container.textContent).not.toContain('Sleep Stages')
  })

  it('a removal still in the outbox hides the night the server still holds', async () => {
    h.serverRows = [TYPED]
    h.store = {
      getSleepSessions: async () => h.localRows,
      getQueuedMutationsForDomain: async () => [{ domain: 'manual_sleep', payload: { id: TYPED.id as string, deleted: true } }],
    }
    await mount()
    expect(container.textContent).not.toContain('Logged by hand')
    // With the night gone, the card is back in its empty state, ready to log again.
    expect(container.textContent).toContain('No night recorded')
  })
})
