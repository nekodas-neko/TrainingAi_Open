// @vitest-environment jsdom
/**
 * #3125 review: the old local pin list moves onto the account only after a fresh server read says the
 * account has none (the cached value may be older than a change made elsewhere), and an edit cannot
 * save while the account's pins are unknown because that read failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let cached: { pins: string[] | null } | null = null
vi.mock('@/lib/hooks/use-cached-value', () => ({ useCachedValue: () => cached }))
vi.mock('@/lib/cache-groups', () => ({ invalidateTrophyPins: async () => {} }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { TrophyCase } from '../trophy-case'
import type { AchievementResult } from '@/components/profile/achievements-grid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const achievements = [
  { id: 'a', name: 'A', unlocked: true, category: 'strength' },
  { id: 'b', name: 'B', unlocked: true, category: 'strength' },
] as unknown as AchievementResult[]

let get: { status: number; body: unknown } | 'network'
const puts: string[] = []
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') { puts.push(String(init.body)); return new Response('{}', { status: 200 }) }
  if (get === 'network') throw new TypeError('offline')
  return new Response(JSON.stringify(get.body), { status: get.status })
})

let root: Root
let host: HTMLDivElement
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
async function mount() {
  await act(async () => { root.render(createElement(TrophyCase, { achievements })) })
  await settle()
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ta_trophy_case', JSON.stringify(['a']))
  puts.length = 0
  fetchMock.mockClear()
  cached = null
  get = { status: 200, body: { pins: null } }
  vi.stubGlobal('fetch', fetchMock)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const editButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Edit')

describe('the trophy case carry-over', () => {
  it('does not carry the old list over a stale cached "no pins" when the server now has pins', async () => {
    cached = { pins: null }
    get = { status: 200, body: { pins: ['b'] } }
    await mount()
    expect(puts).toEqual([])
    expect(localStorage.getItem('ta_trophy_case')).toBeNull() // dropped, never to overwrite later
  })

  it('carries the old list over once the server confirms the account has none', async () => {
    cached = { pins: null }
    get = { status: 200, body: { pins: null } }
    await mount()
    expect(puts.map(p => JSON.parse(p))).toEqual([{ pins: ['a'] }])
  })

  it('waits, keeping the old list, when the fresh read fails', async () => {
    cached = { pins: null }
    get = { status: 500, body: {} }
    await mount()
    expect(puts).toEqual([])
    expect(JSON.parse(localStorage.getItem('ta_trophy_case')!)).toEqual(['a'])
  })
})

describe('editing while the account pins are unknown', () => {
  it('offers no edit when the read failed and nothing is cached', async () => {
    cached = null
    get = 'network'
    await mount()
    expect(editButton()).toBeUndefined()
    expect(puts).toEqual([])
  })

  it('offers the edit once the account pins are read', async () => {
    cached = null
    get = { status: 200, body: { pins: ['b'] } }
    await mount()
    expect(editButton()).toBeDefined()
  })

  it('offers the edit from the cached pins while the fresh read is failing', async () => {
    cached = { pins: ['b'] }
    get = 'network'
    await mount()
    expect(editButton()).toBeDefined()
  })
})
