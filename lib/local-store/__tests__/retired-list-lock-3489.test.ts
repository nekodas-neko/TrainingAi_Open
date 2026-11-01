// #3489. The retired-food list is one JSON value in `sync_meta`, so every change to it is a
// read-modify-write. The pull (under the sync apply lock) and the day-list hydrate (not under it)
// both change it; two overlapping updates each read the old list and the later write lost the
// other's id, leaving a retired food in search for good. Also pins the sign-out window: the store
// registry is dropped before the DELETEs, so a pull that takes the lock mid-clear applies nothing.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import Module from 'node:module'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
vi.mock('../device-owner', () => ({ storeOwnedByAnotherAccount: () => false }))
// With `window` present the epoch gate would call the network; it is none of what this file pins.
vi.mock('../data-epoch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data-epoch')>()),
  verifyDataEpoch: async () => 'ok' as const,
}))

import { openVectorDb, runSQL } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'
import { getLocalStore, clearLocalStoreData } from '../index'
import type { LocalFoodItem } from '../types'
import { pullDelta, _resetSyncBackoff } from '../sync-engine'

// `getLocalStore` loads the backend with a CommonJS require that vitest cannot resolve (see
// pull-invalidation.test.ts). The sign-out tests need the real registry, so the require is answered
// with the module this file already imported.
const realRequire = Module.prototype.require
beforeAll(() => {
  Module.prototype.require = function (this: NodeModule, id: string) {
    return id === './sqlite-backend' ? { SQLiteLocalStore } : realRequire.call(this, id)
  } as typeof Module.prototype.require
})
afterAll(() => { Module.prototype.require = realRequire })

const BASE = {
  programs: [], progressionStyles: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
  activityLogs: [], workoutSessions: [],
}
// The wire shape (what a pull page carries) and the local shape differ only in the nullable extras.
const food = (id: string, deletedAt: string | null): LocalFoodItem => ({
  id, name: `Food ${id}`, brand: 'Sunsol', servingSizeG: 45, calories: 200, proteinG: 5, carbsG: 28,
  fatG: 7, fiberG: null, sugarG: null, sodiumMg: null, satFatG: null, source: 'manual', barcode: null,
  imageDataUri: null, updatedAt: '2026-10-01T00:00:00.000Z', deletedAt,
})
const T_DEL = '2026-10-10T10:05:00.000Z'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const respond = (page: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ ...BASE, ...page }) })
const other = { ok: true, status: 200, json: async () => ({}) }

beforeEach(() => {
  openVectorDb()
  _resetSyncBackoff()
  vi.stubGlobal('window', {})
})
afterEach(() => { vi.unstubAllGlobals() })

// Holds every saved-meal ingredient so a tombstoned food keeps its row (hidden, not swept away).
async function pin(...ids: string[]) {
  for (const id of ids) {
    await runSQL(`INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier) VALUES (?, 'm1', ?, 1)`, [`i-${id}`, id])
  }
}

// The shared parity connection cannot hold two `applyDelta` transactions open at once, so the race is
// driven at the step both writers run before their transaction: the retired list's read-modify-write.
type WithRetire = { updateRetiredFoods(add: string[], forget: string[]): Promise<void> }
const retire = (s: SQLiteLocalStore) => s as unknown as WithRetire
function slowReads(s: SQLiteLocalStore) {
  const real = s.getRetiredFoodIds.bind(s)
  // A slow read widens the window: without the mutex both updates read the old list.
  s.getRetiredFoodIds = async () => { const ids = await real(); await sleep(5); return ids }
  return real
}
async function seedPinned(s: SQLiteLocalStore, ...ids: string[]) {
  await s.applyDelta({ foodItems: ids.map(id => food(id, null)) })
  await pin(...ids)
}

describe('retired-food list updates (#3489)', () => {
  it('two concurrent updates keep both ids', async () => {
    const store = new SQLiteLocalStore()
    const read = slowReads(store)
    await Promise.all([retire(store).updateRetiredFoods(['A'], []), retire(store).updateRetiredFoods(['B'], [])])
    expect((await read()).sort()).toEqual(['A', 'B'])
  })

  it('a forget racing an add keeps the added id', async () => {
    const store = new SQLiteLocalStore()
    const read = slowReads(store)
    await retire(store).updateRetiredFoods(['A'], [])
    await Promise.all([retire(store).updateRetiredFoods([], ['A']), retire(store).updateRetiredFoods(['B'], [])])
    expect((await read()).sort()).toEqual(['B'])
  })

  it('a real pull racing the hydrate\'s update loses neither id', async () => {
    const store = getLocalStore('u') as SQLiteLocalStore
    await seedPinned(store, 'A', 'B')
    const read = slowReads(store)
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('/api/sync/pull') ? respond({ syncedAt: T_DEL, foodItems: [food('A', T_DEL)] }) : other))
    const [pulled] = await Promise.all([
      pullDelta('u', true),
      retire(store).updateRetiredFoods(['B'], []),   // what the hydrate's applyDelta runs for a retired food
    ])
    expect(pulled).not.toBeNull()
    expect((await read()).sort()).toEqual(['A', 'B'])
  })

  it('the sweep forgets only the ids it dropped, not an id added while it ran', async () => {
    const store = new SQLiteLocalStore()
    await seedPinned(store, 'B')
    await store.applyDelta({ foodItems: [food('A', null)] })     // A has no pin: the sweep drops it
    const read = slowReads(store)
    await Promise.all([
      store.applyDelta({ foodItems: [food('A', T_DEL)] }),
      retire(store).updateRetiredFoods(['B'], []),
    ])
    expect(await read()).toEqual(['B'])
  })
})

describe('sign-out clear (#3489)', () => {
  it('a pull that takes the lock mid-clear applies nothing', async () => {
    const store = getLocalStore('u')! as SQLiteLocalStore
    await store.applyDelta({ foodItems: [food('keeper', null)] })
    let fetches = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/sync/pull')) return other
      fetches += 1
      return respond({ syncedAt: T_DEL, foodItems: [food(fetches === 1 ? 'first' : 'stale', null)] })
    }))
    // Pull A holds the apply lock; pull B has fetched with the old store and waits behind it.
    const releaseA = (() => { let r!: () => void; const p = new Promise<void>(res => { r = res }); return { p, r } })()
    const realApply = store.applyDelta.bind(store)
    let applies = 0
    store.applyDelta = async (delta) => { applies += 1; if (applies === 1) await releaseA.p; return realApply(delta) }
    const pullA = pullDelta('u', true)
    await sleep(20)
    const pullB = pullDelta('u', true)
    await sleep(20)
    // The clear starts, and its first DELETE is held open: the sign-out is mid-wipe when A lets go.
    const sqlService = await import('./parity/node-sqlite-service')
    const realRun = sqlService.runSQL
    const gate = (() => { let r!: () => void; const p = new Promise<void>(res => { r = res }); return { p, r } })()
    const spy = vi.spyOn(sqlService, 'runSQL').mockImplementation(async (q: string, v?: unknown[]) => {
      if (q.startsWith('DELETE FROM')) await gate.p
      return realRun(q, v)
    })
    const clearing = clearLocalStoreData()
    await sleep(10)
    releaseA.r()                                   // B now takes the lock while the DELETEs are paused
    await pullA
    expect(await pullB).toBeNull()
    expect(applies).toBe(1)                        // B never reached applyDelta
    gate.r()
    await clearing
    spy.mockRestore()
  })

  it('a same-account re-init after the clear still syncs', async () => {
    const before = getLocalStore('u')!
    await clearLocalStoreData()
    const after = getLocalStore('u')!
    expect(after).not.toBe(before)
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('/api/sync/pull') ? respond({ syncedAt: T_DEL, foodItems: [food('fresh', null)] }) : other))
    expect(await pullDelta('u', true)).not.toBeNull()
    expect((await after.searchFoodItems('fresh')).map(f => f.id)).toEqual(['fresh'])
  })
})
