// #3197: follow-ups to the Oura Health Connect filter (#3195) in the current app: the history import,
// the rewind after a disconnect, the skip counts, and the one read path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const cache = vi.hoisted(() => ({ value: null as unknown }))
const hc = vi.hoisted(() => ({ records: [] as Array<{ type: string; time: string; origin: string; id: string }>, readRecords: vi.fn() }))

vi.mock('@/lib/sqlite/cache', () => ({ readCacheSync: () => cache.value }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: ['Weight', 'HealthDataHistory'], write: [] }),
    getGrantedPermissions: async () => ({ read: ['Weight', 'HealthDataHistory'], write: [] }),
    aggregateRecords: async () => ({ aggregates: [] }),
    readRecords: hc.readRecords,
  },
}))

import {
  syncHealthConnect, syncWindowIso, rememberSyncSkipped, readLastSyncSkipped,
  LAST_SYNC_KEY, SKIPPED_SINCE_KEY, SYNC_DAYS_COLD,
} from '../health-connect-sync'
import { importMoreHistory, coldSyncOldestDay } from '../health-connect-history-import'
import { OURA_APP_PACKAGE } from '@trainingai/shared/health/health-connect-origin'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const SAMSUNG = 'com.sec.android.app.shealth'
const today = () => todayInTz(TZ)
const connected = (ouraCloud: boolean) => {
  cache.value = { date: today(), data: { connectedSources: { ring: false, strap: false, healthConnect: true, ouraCloud } } }
}
const noonOf = (day: string) => dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000

let store: Map<string, string>
let posts: Array<{ url: string; body: Record<string, unknown> | null }>
beforeEach(() => {
  cache.value = null
  hc.records = []
  hc.readRecords.mockReset()
  hc.readRecords.mockImplementation(async ({ start, end, type }: { start: string; end: string; type: string }) => ({
    records: hc.records
      .filter(r => r.type === type && r.time >= start && r.time < end)
      .map(r => ({ time: r.time, value: 80, metadata: { id: r.id, dataOrigin: r.origin } })),
  }))
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    posts.push({ url, body: init?.body ? JSON.parse(init.body as string) : null })
    return { ok: true, status: 200, json: async () => ({ oldestDate: null, enrichmentCandidates: [] }), text: async () => '' }
  }))
})
afterEach(() => vi.unstubAllGlobals())

const weight = (day: string, origin: string, id = `${origin}-${day}`) =>
  ({ type: 'Weight', time: new Date(noonOf(day)).toISOString(), origin, id })
const syncPosts = () => posts.filter(p => p.url === '/api/sync-health')

describe('history import with skipped records (#3115, #3197)', () => {
  // Without `&& !r.skippedFirstHand` at lib/health-connect-history-import.ts, the first window below
  // reads as the empty past and the import ends before the second.
  it('does not end the import at a window whose only records were skipped Oura copies', async () => {
    connected(true)
    const cold = coldSyncOldestDay(today())
    hc.records = [weight(shiftDateStr(cold, -5), OURA_APP_PACKAGE), weight(shiftDateStr(cold, -40), SAMSUNG)]
    const out = await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    expect(out).toMatchObject({ end: 'exhausted', windows: 2 })
    expect(syncPosts()).toHaveLength(1)
  })
})

describe('rewind after a disconnect (#3197)', () => {
  const firstReadStart = () => (hc.readRecords.mock.calls[0][0] as { start: string }).start
  const daysBackOf = (start: string) => {
    for (const d of [7, SYNC_DAYS_COLD]) if (syncWindowIso(today(), d, TZ).startIso === start) return d
    return null
  }

  it('reads the cold window again once Oura Cloud reads as disconnected, then goes back to the hot one', async () => {
    hc.records = [weight(shiftDateStr(today(), -20), OURA_APP_PACKAGE)]

    connected(true)
    const first = await syncHealthConnect(TZ)
    expect(first?.skippedFirstHand).toEqual({ Weight: 1 })
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(true)
    expect(store.has(LAST_SYNC_KEY)).toBe(true)

    // Still connected: a hot sync, and nothing is rewound.
    hc.readRecords.mockClear()
    await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBe(7)

    // Not known (the mirror was cleared): neither rewinds nor drops the marker.
    cache.value = null
    hc.readRecords.mockClear()
    await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBe(7)
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(true)

    connected(false)
    hc.readRecords.mockClear()
    posts = []
    const after = await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBe(SYNC_DAYS_COLD)
    expect(after?.skippedFirstHand).toBeUndefined()
    expect(syncPosts()[0].body).toMatchObject({ dailyMetrics: [expect.objectContaining({ weightKg: 80 })] })
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(false)

    hc.readRecords.mockClear()
    await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBe(7)
  })

  it('does not rewind when nothing was ever skipped', async () => {
    hc.records = [weight(shiftDateStr(today(), -1), SAMSUNG)]
    connected(false)
    await syncHealthConnect(TZ)
    hc.readRecords.mockClear()
    await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBe(7)
  })
})

describe('skip counts reach the place they are reported (#3197)', () => {
  it('keeps the last sync\'s counts, replacing the ones before it', () => {
    rememberSyncSkipped({ metrics: 0, sessions: 0, sleep: 0, heartRate: 0, intervals: 0, skippedFirstHand: { Weight: 2 } })
    expect(readLastSyncSkipped()).toEqual({ Weight: 2 })
    rememberSyncSkipped({ metrics: 1, sessions: 0, sleep: 0, heartRate: 0, intervals: 0 })
    expect(readLastSyncSkipped()).toEqual({})
    rememberSyncSkipped(null)
    expect(readLastSyncSkipped()).toEqual({})
  })

  it('a rescan of the same window counts the records once per sync, not again', async () => {
    connected(true)
    hc.records = [weight(shiftDateStr(today(), -1), OURA_APP_PACKAGE)]
    const a = await syncHealthConnect(TZ)
    const b = await syncHealthConnect(TZ)
    expect(a?.skippedFirstHand).toEqual({ Weight: 1 })
    expect(b?.skippedFirstHand).toEqual({ Weight: 1 })
  })
})

describe('the provider hands the sync result on (#3197)', () => {
  it('passes every result to rememberSyncSkipped instead of dropping it', () => {
    const src = readFileSync('components/health-connect-provider.tsx', 'utf8')
    expect(src).toMatch(/syncHealthConnect\(tz\)\.then\(rememberSyncSkipped\)/)
  })
})

describe('one read path (#3197)', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      if (name === 'node_modules' || name === '__tests__' || name === '__check_fixture__' || name.startsWith('.')) return []
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  const code = (path: string) => stripComments(readFileSync(path, 'utf8'))

  it('only readFiltered calls readRecords, and no other file reads records from the plugin', () => {
    const readers = ['lib', 'components', 'app', 'hooks']
      .flatMap(dir => { try { return walk(dir) } catch { return [] } })
      .filter(path => /\breadRecords\s*\(/.test(code(path)))
    expect(readers).toEqual(['lib/health-connect-sync.ts'])
    expect(code('lib/health-connect-sync.ts').match(/\breadRecords\s*\(/g)).toHaveLength(1)
  })
})
