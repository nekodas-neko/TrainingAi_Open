// #3369 — a wipe that only half worked must not report success, because success opens the gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sql = vi.hoisted(() => ({
  tables: ['workout_sessions', 'food_logs', 'api_cache', 'exercise_library'],
  failDelete: new Set<string>(),
  deleted: [] as string[],
  rows: {} as Record<string, number>,
}))
const cache = vi.hoisted(() => ({ clearAllCache: vi.fn(async (_o?: { throwOnError?: boolean }) => {}), disableCacheWrites: vi.fn() }))

vi.mock('@/lib/sqlite/sqlite-service', async () => ({
  isSQLiteAvailable: () => true,
  isLocalStoreDead: () => false,
  querySQL: vi.fn(async (q: string) => {
    if (q.includes('sqlite_master')) return sql.tables.map(name => ({ name }))
    const m = /FROM (\w+) LIMIT 1/.exec(q)
    return m && (sql.rows[m[1]] ?? 0) > 0 ? [{ x: 1 }] : []
  }),
  runSQL: vi.fn(async (q: string) => {
    const name = /DELETE FROM (\w+)/.exec(q)![1]
    sql.deleted.push(name)
    if (sql.failDelete.has(name)) throw new Error(`cannot delete ${name}`)
  }),
}))
vi.mock('@/lib/sqlite/cache', () => cache)
vi.mock('@/lib/sign-out-storage', () => ({ clearAccountStorage: vi.fn() }))

import { clearLocalStoreData, deviceHasLocalData } from '../index'
import { wipeDevice } from '../data-epoch'

beforeEach(() => {
  sql.failDelete.clear(); sql.deleted.length = 0; sql.rows = {}
  cache.clearAllCache.mockReset().mockResolvedValue(undefined)
  // `document` is absent in the node environment; the cookie mirror is best-effort and try/caught.
})

describe('wipeDevice', () => {
  it('resolves when every clear worked', async () => {
    await expect(wipeDevice()).resolves.toBeUndefined()
    expect(sql.deleted.sort()).toEqual(['food_logs', 'workout_sessions'])
    expect(cache.clearAllCache).toHaveBeenCalledWith({ throwOnError: true })
  })
  it('rejects when a table could not be cleared, after trying the rest', async () => {
    sql.failDelete.add('workout_sessions')
    await expect(wipeDevice()).rejects.toThrow(/not cleared/)
    expect(sql.deleted).toContain('food_logs')
    expect(cache.clearAllCache).not.toHaveBeenCalled()
  })
  it('rejects when the cache could not be cleared', async () => {
    cache.clearAllCache.mockRejectedValueOnce(new Error('api_cache locked'))
    await expect(wipeDevice()).rejects.toThrow('api_cache locked')
  })
})

describe('clearLocalStoreData', () => {
  it('still throws on a partial clear, naming how many tables were left', async () => {
    sql.failDelete.add('food_logs')
    await expect(clearLocalStoreData()).rejects.toThrow(/1 table\(s\)/)
  })
})

describe('deviceHasLocalData', () => {
  it('is false for a store whose only rows are in the kept tables', async () => {
    sql.rows = { exercise_library: 40, api_cache: 3 }
    expect(await deviceHasLocalData()).toBe(false)
  })
  it('is true as soon as any other table holds a row', async () => {
    sql.rows = { food_logs: 1 }
    expect(await deviceHasLocalData()).toBe(true)
  })
})
