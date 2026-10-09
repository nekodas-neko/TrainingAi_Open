// @vitest-environment jsdom
/**
 * Issue 2187 — the collection screen and Home card read the v2 block of /api/collection: four rows
 * of six tiers (Tank, Ranger, Health cat, Rogue), the Rogue marked provisional, no v1 sleep row.
 * Mounts the real components with the cache hook stubbed to a fixed response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'fs'
import path from 'path'
import { V2_LADDERS, type CollectionState } from '@trainingai/shared/collection/ladder'

const h = vi.hoisted(() => ({ data: null as unknown, calls: [] as unknown[][] }))
vi.mock('@/lib/hooks/use-cached-value', () => ({
  useCachedValue: (...args: unknown[]) => { h.calls.push(args); return h.data },
}))
vi.mock('@/lib/view-transition', () => ({ useTransitionRouter: () => ({ back: () => {} }) }))
vi.mock('@/components/home/collection-pen', () => ({ CollectionPen: () => createElement('div', { 'data-testid': 'pen' }) }))

import { CollectionContent } from '../../../app/collection/collection-content'
import { CollectionCard } from '../collection-card'

const stateOf = (stock: number[], extra: Partial<CollectionState> = {}): CollectionState =>
  ({ stock: [...stock, 0, 0, 0, 0, 0, 0].slice(0, 6), duplicateDays: 0, decayEvents: 0, ...extra })

const v2 = (over: Partial<Record<keyof typeof V2_LADDERS, CollectionState>> = {}) => ({
  today: '2026-10-09',
  v2: {
    rulesVersion: 2,
    collections: {
      workout: stateOf([1, 1, 1, 1, 1, 1]),
      steps: stateOf([2, 1]),
      health: stateOf([1, 1, 0, 2]),
      cardio: stateOf([2]),
      ...over,
    },
  },
})

let host: HTMLDivElement
let root: Root
beforeEach(() => { h.calls = []; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = (el: React.ReactElement) => act(() => { root.render(el) })

describe('the collection screen reads v2', () => {
  it('draws four rows with all six tiers each, named from the v2 ladders, with the one cache key', () => {
    h.data = v2()
    mount(createElement(CollectionContent))
    const text = host.textContent ?? ''
    for (const t of ['Workouts', 'Steps', 'Health logging', 'Cardio sessions']) expect(text).toContain(t)
    for (const ladder of Object.values(V2_LADDERS)) for (const tier of ladder.tiers) expect(text).toContain(tier.name)
    expect(host.querySelectorAll('section ul img').length).toBeGreaterThanOrEqual(24)
    expect(h.calls[0].slice(0, 2)).toEqual(['collection', '/api/collection'])
  })

  it('draws the Rogue and the Health cat as their own art, and labels the Rogue provisional', () => {
    h.data = v2()
    mount(createElement(CollectionContent))
    const srcs = [...host.querySelectorAll('img')].map(i => i.getAttribute('src'))
    for (let t = 1; t <= 6; t++) expect(srcs).toContain(`/cats/rogue-${t}.svg`)
    for (let t = 1; t <= 6; t++) expect(srcs).toContain(`/cats/cleric-${t}.svg`)
    const cardio = [...host.querySelectorAll('section')].find(s => s.textContent?.includes('Cardio sessions'))!
    expect(cardio.textContent).toContain('provisional')
    expect(host.textContent).not.toContain('Nights of sleep')
  })

  it('quotes the engine constants in the rules copy', () => {
    h.data = v2()
    mount(createElement(CollectionContent))
    const text = host.textContent ?? ''
    expect(text).toContain('5,000')
    expect(text).toContain('1,000')
    expect(text).toContain('walk, run, treadmill')
  })

  it('shows the skeleton for a cached response from before the route returned v2, not a v1 fallback', () => {
    h.data = { collections: { workout: stateOf([9]) }, today: '2026-10-09' }
    mount(createElement(CollectionContent))
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(host.textContent).not.toContain('Workouts')
  })
})

describe('the Home card reads v2', () => {
  it('shows the pen on the one cache key', () => {
    h.data = v2()
    mount(createElement(CollectionCard))
    expect(host.querySelector('[data-testid="pen"]')).not.toBeNull()
    expect(h.calls[0].slice(0, 2)).toEqual(['collection', '/api/collection'])
  })

  it('offers the nearest merge in v2 names', () => {
    h.data = v2({ workout: stateOf([]), steps: stateOf([2]), health: stateOf([]), cardio: stateOf([]) })
    mount(createElement(CollectionCard))
    expect(host.textContent).toContain('Ranger II')
    expect(host.textContent).toContain('1 more tier I cat')
  })
})

describe('no v1 leftovers on the surface', () => {
  it('no surface file reads the v1 ladders, the v1 block or the sleep row', () => {
    const base = path.join(__dirname, '../../..')
    for (const f of ['app/collection/collection-content.tsx', 'app/collection/cat-roster.tsx', 'components/home/collection-card.tsx',
      'components/home/collection-summary.ts', 'components/home/collection-sprites.ts', 'components/home/collection-pen-cats.ts', 'components/home/collection-pen.tsx']) {
      const src = fs.readFileSync(path.join(base, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/(?<!V2_)\bLADDERS\b/)
      expect(src, f).not.toMatch(/data\.collections|SLEEP_MAX_REST_GAP|STEPS_MAX_REST_GAP|sleep:/)
    }
  })
})
