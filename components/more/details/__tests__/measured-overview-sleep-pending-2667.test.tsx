// @vitest-environment jsdom
// Issue 2667 — the More tab's sleep averages are built from the `/api/sleep-sessions` reply, which
// still holds a night removed on the Sleep screen until the outbox pushes. Mounts the real section.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  server: [] as unknown[],
  store: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => h.store }))
vi.mock('@/lib/hooks/use-cached-value', () => ({ useCachedValue: () => h.server }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))

import { MeasuredOverviewSection } from '../measured-overview-section'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const night = (id: string, date: string, durationHours: number, manualEntry = false) => ({
  id, date, durationHours, efficiency: null, lowestHeartRate: null, respiratoryRate: null,
  sleepStart: `${date}T12:00:00.000Z`, sleepEnd: `${date}T20:00:00.000Z`, manualEntry,
})

let host: HTMLElement
let root: Root
async function mount() {
  await act(async () => { root.render(createElement(MeasuredOverviewSection, { userId: 'u1' })) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return host.textContent ?? ''
}

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); h.store = null })

describe('More tab sleep averages with pending manual writes', () => {
  it('a removed night no longer counts', async () => {
    h.server = [night('dev1', '2026-10-06', 8), night('typed-removed', '2026-10-07', 4, true)]
    h.store = {
      getBodyMetrics: async () => [],
      getSleepSessions: async () => [],
      getQueuedMutationsForDomain: async () => [{ domain: 'manual_sleep', payload: { id: 'typed-removed', deleted: true } }],
    }
    const text = await mount()
    expect(text).toContain('average of 1 night')
    expect(text).toContain('8.0 h')
  })

  it('a typed night the server does not have yet counts', async () => {
    h.server = [night('dev1', '2026-10-06', 8)]
    h.store = {
      getBodyMetrics: async () => [],
      getSleepSessions: async () => [{ ...night('typed-new', '2026-10-07', 6, true), manualSleepStart: null }],
      getQueuedMutationsForDomain: async () => [],
    }
    const text = await mount()
    expect(text).toContain('average of 2 nights')
    expect(text).toContain('7.0 h')
  })

  it('with no local store (the web build) the reply is shown as it came', async () => {
    h.server = [night('dev1', '2026-10-07', 8), night('dev2', '2026-10-06', 6)]
    h.store = null
    const text = await mount()
    expect(text).toContain('average of 2 nights')
    expect(text).toContain('7.0 h')
  })
})
