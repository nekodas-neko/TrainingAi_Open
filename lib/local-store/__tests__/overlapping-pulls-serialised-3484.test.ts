// #3484 item 1. Two overlapping `pullDelta` calls fetch concurrently but must apply one at a time.
// Unserialised, the stale pull's shorter post-apply chain wrote the cursor before the newer pull's
// longer one: the cursor ended at the newer time with the stale rows (the retired food live) on top,
// so no later pull re-delivered the tombstone. Drives the real `pullDelta` and the real write queue.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
const store: { current: import('../sqlite-backend').SQLiteLocalStore | null } = { current: null }
vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>()
  return { ...actual, getLocalStore: () => store.current }
})

import { pullDelta, _resetSyncBackoff } from '../sync-engine'
import { openVectorDb, runSQL } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'

const BASE = {
  programs: [], progressionStyles: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
  activityLogs: [], workoutSessions: [],
}
const food = (id: string, deletedAt: string | null) => ({
  id, name: 'Sunsol Granola', brand: 'Sunsol', servingSizeG: 45, calories: 200, proteinG: 5, carbsG: 28,
  fatG: 7, source: 'manual', createdAt: '2026-10-01T00:00:00.000Z', deletedAt,
})
const T_OLD = '2026-10-10T10:00:00.000Z'   // the stale pull read the server here, before the merge
const T_MERGE = '2026-10-10T10:05:00.000Z'
const T_NEW = '2026-10-10T10:06:00.000Z'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
const other = { ok: true, status: 200, json: async () => ({}) }
const respond = (page: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ ...BASE, ...page }) })

async function seedKeeperAndExtra() {
  vi.stubGlobal('fetch', vi.fn(async () =>
    respond({ syncedAt: '2026-10-10T09:00:00.000Z', foodItems: [food('keeper', null), food('extra', null)] })))
  await pullDelta('u', true)
  // A saved-meal ingredient keeps the tombstoned row (hidden, not dropped).
  await runSQL(`INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier) VALUES ('i1','m1','extra',1)`)
}

beforeEach(() => {
  openVectorDb()
  _resetSyncBackoff()
  store.current = new SQLiteLocalStore()
})

describe('overlapping pulls apply one at a time (#3484)', () => {
  it('never leaves the cursor at the newer pull with the retired food searchable again', async () => {
    await seedKeeperAndExtra()
    const s = store.current!

    // Pull A is stale (read before the merge, food live) and its response arrives late; pull B carries
    // the tombstone. Hold B in its post-apply chain until A has had every chance to run alongside it.
    const releaseA = deferred()
    const aCursorWritten = deferred()
    let fetches = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/sync/pull')) return other
      fetches += 1
      if (fetches === 1) { await releaseA.promise; return respond({ syncedAt: T_OLD, foodItems: [food('extra', null)] }) }
      return respond({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
    }))
    const realPrune = s.pruneProgramStructure.bind(s)
    const realSetCursor = s.setLastSyncAt.bind(s)
    let prunes = 0
    s.pruneProgramStructure = async (...args) => {
      prunes += 1
      if (prunes === 1) {                                     // B, first to apply
        releaseA.resolve()
        await Promise.race([aCursorWritten.promise, sleep(50)])
      }
      return realPrune(...args)
    }
    s.setLastSyncAt = async (d) => {
      await realSetCursor(d)
      if (d === T_OLD) aCursorWritten.resolve()
    }

    const pullA = pullDelta('u', true)
    const pullB = pullDelta('u', true)
    const [a, b] = await Promise.all([pullA, pullB])
    expect(a).not.toBeNull()                                  // no pull is dropped
    expect(b).not.toBeNull()
    expect(fetches).toBe(2)

    const cursor = await s.getLastSyncAt()
    const searchable = (await s.searchFoodItems('granola')).map(f => f.id).sort()
    if (searchable.length === 2) expect(cursor).toEqual(new Date(T_OLD))   // live: the cursor is back, so the next pull heals it
    else {
      expect(searchable).toEqual(['keeper'])
      expect(cursor).toEqual(new Date(T_NEW))
    }
    // The state the race produced: the stale rows on top with the newer cursor.
    expect(searchable.length === 2 && cursor.getTime() === new Date(T_NEW).getTime()).toBe(false)
  })

  it('applies in arrival order: the stale pull last leaves the cursor back, and the next pull heals', async () => {
    await seedKeeperAndExtra()
    const s = store.current!
    let fetches = 0
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/sync/pull')) return other
      urls.push(url)
      fetches += 1
      if (fetches === 1) { await sleep(30); return respond({ syncedAt: T_OLD, foodItems: [food('extra', null)] }) }
      if (fetches === 2) return respond({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
      return respond({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
    }))
    await Promise.all([pullDelta('u', true), pullDelta('u', true)])
    expect(await s.getLastSyncAt()).toEqual(new Date(T_OLD))
    await pullDelta('u', true)
    expect(urls[2]).toContain(`since=${T_OLD}`)
    expect((await s.searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
    expect(await s.getLastSyncAt()).toEqual(new Date(T_NEW))
  })

  it('a pull that throws while applying does not block the pull waiting behind it', async () => {
    await seedKeeperAndExtra()
    const s = store.current!
    let fetches = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.startsWith('/api/sync/pull')) return other
      fetches += 1
      return respond({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
    }))
    const realApply = s.applyDelta.bind(s)
    let applies = 0
    s.applyDelta = async (delta) => {
      applies += 1
      if (applies === 1) { await sleep(20); throw new Error('boom') }
      return realApply(delta)
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const [a, b] = await Promise.all([pullDelta('u', true), pullDelta('u', true)])
    errors.mockRestore()
    expect(a).toBeNull()
    expect(b).not.toBeNull()
    expect(applies).toBe(2)
    expect(await s.getRetiredFoodIds()).toEqual(['extra'])
    expect(await s.getLastSyncAt()).toEqual(new Date(T_NEW))
  })

  it('a failed pull does not block a later one either', async () => {
    await seedKeeperAndExtra()
    const s = store.current!
    const realApply = s.applyDelta.bind(s)
    let applies = 0
    s.applyDelta = async (delta) => {
      applies += 1
      if (applies === 1) throw new Error('boom')
      return realApply(delta)
    }
    vi.stubGlobal('fetch', vi.fn(async () => respond({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await pullDelta('u', true)).toBeNull()
    errors.mockRestore()
    _resetSyncBackoff()
    expect(await pullDelta('u', true)).not.toBeNull()
    expect(await s.getRetiredFoodIds()).toEqual(['extra'])
  })
})
