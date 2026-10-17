// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
const fetched: string[] = []
vi.mock('@/lib/sqlite/cache', () => ({
  cachedFetch: (key: string) => { fetched.push(key); return Promise.resolve(null) },
  cachedFetchToday: (key: string) => { fetched.push(key); return Promise.resolve(null) },
  readCacheSync: () => null,
  readTodayCacheSync: () => null,
  subscribeToInvalidation: () => () => {},
}))
vi.mock('@/components/shell/local-day-provider', () => ({ useLocalDay: () => '2026-10-18' }))
vi.mock('@/components/shell/user-timezone-provider', () => ({ useUserTimezone: () => 'Australia/Brisbane' }))
vi.mock('@/components/health/hr-day-chart', () => ({ HrDayChart: () => null }))

import { HrDayCard } from '@/components/health/hr-day-card'
import { TabVisibilityProvider } from '@/components/shell/tab-visibility'
import { subscribeToAppResume, type ResumeSource } from '../use-revalidate-on-return'

function fakeDoc(): ResumeSource & { fire(state: string): void; listeners: number } {
  const set = new Set<() => void>()
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_t: 'visibilitychange', cb: () => void) => { set.add(cb) },
    removeEventListener: (_t: 'visibilitychange', cb: () => void) => { set.delete(cb) },
    fire(state: string) { doc.visibilityState = state; for (const cb of [...set]) cb() },
    get listeners() { return set.size },
  }
  return doc
}

describe('subscribeToAppResume (issue 2906: the HR card revalidates when the app comes back)', () => {
  it('fires on each return to the foreground and not on going to the background', () => {
    const doc = fakeDoc()
    let n = 0
    subscribeToAppResume(doc, () => { n++ })
    doc.fire('hidden')
    expect(n).toBe(0)
    doc.fire('visible')
    doc.fire('hidden')
    doc.fire('visible')
    expect(n).toBe(2)
  })

  it('stops firing once unsubscribed', () => {
    const doc = fakeDoc()
    let n = 0
    const off = subscribeToAppResume(doc, () => { n++ })
    off()
    doc.fire('visible')
    expect(n).toBe(0)
    expect(doc.listeners).toBe(0)
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('the real heart-rate card revalidates on return (issue 2906)', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  const count = (key: string) => fetched.filter(k => k === key).length
  const HR = 'oura-hr-day:2026-10-18'
  const WS = 'workout-sessions-day:2026-10-18'
  const STRESS = 'stress-day:2026-10-18'

  // The provider types `children` as a prop; pass it there so the type checks without JSX.
  // eslint-disable-next-line react/no-children-prop
  const shell = (visible: boolean, epoch: number) => createElement(TabVisibilityProvider, { visible, epoch, children: createElement(HrDayCard) })
  const card = (epoch: number) => shell(true, epoch)
  async function mount(epoch = 0) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root!.render(card(epoch)) })
  }
  async function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  }
  afterEach(async () => {
    await act(async () => { root?.unmount() })
    host?.remove()
    root = null
    host = null
    fetched.length = 0
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('fetches each key once on mount, with no extra request from the revalidation hook', async () => {
    await mount()
    expect(count(HR)).toBe(1)
    expect(count(WS)).toBe(1)
    expect(count(STRESS)).toBe(1)
  })

  it('refetches every key once when the app becomes visible, and not when it goes hidden', async () => {
    await mount()
    await setVisibility('hidden')
    expect(count(HR)).toBe(1)
    expect(count(WS)).toBe(1)
    expect(count(STRESS)).toBe(1)
    await setVisibility('visible')
    expect(count(HR)).toBe(2)
    expect(count(WS)).toBe(2)
    expect(count(STRESS)).toBe(2)
  })

  it('refetches every key once when the shell re-shows the tab', async () => {
    await mount()
    await act(async () => { root!.render(card(1)) })
    expect(count(HR)).toBe(2)
    expect(count(WS)).toBe(2)
    expect(count(STRESS)).toBe(2)
  })

  it('does not count an app resume while the shell is showing another tab', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const away = shell(false, 0)
    await act(async () => { root!.render(away) })
    await setVisibility('visible')
    expect(count(HR)).toBe(1)
  })

  it('removes its listener on unmount', async () => {
    const added: EventListenerOrEventListenerObject[] = []
    const removed: EventListenerOrEventListenerObject[] = []
    const add = vi.spyOn(document, 'addEventListener').mockImplementation((t, cb) => { if (t === 'visibilitychange') added.push(cb as EventListener) })
    const rem = vi.spyOn(document, 'removeEventListener').mockImplementation((t, cb) => { if (t === 'visibilitychange') removed.push(cb as EventListener) })
    await mount()
    expect(added).toHaveLength(1)
    await act(async () => { root!.unmount() })
    root = null
    expect(removed).toEqual(added)
    add.mockRestore()
    rem.mockRestore()
  })
})
