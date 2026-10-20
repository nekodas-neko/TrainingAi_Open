// #3197: follow-ups to the Oura Health Connect filter (#3195) in the current app: the history import,
// the rewind after a disconnect, the skip counts, and the one read path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const cache = vi.hoisted(() => ({ value: null as unknown }))
const hc = vi.hoisted(() => ({ records: [] as Array<{ type: string; time: string; origin: string; id: string; samples?: unknown[] }>,
  failRead: null as string | null, readRecords: vi.fn() }))

vi.mock('@/lib/sqlite/cache', () => ({ readCacheSync: () => cache.value }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: ['Weight', 'HeartRateSeries', 'HealthDataHistory'], write: [] }),
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
let failHeartRatePost = false
beforeEach(() => {
  failHeartRatePost = false
  cache.value = null
  hc.records = []
  hc.readRecords.mockReset()
  hc.failRead = null
  hc.readRecords.mockImplementation(async ({ start, end, type }: { start: string; end: string; type: string }) => {
    if (hc.failRead === type) throw new Error('read failed')
    return {
      records: hc.records
        .filter(r => r.type === type && r.time >= start && r.time < end)
        .map(r => ({ time: r.time, value: 80, ...(r.samples ? { samples: r.samples } : {}), metadata: { id: r.id, dataOrigin: r.origin } })),
    }
  })
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null
    posts.push({ url, body })
    if (failHeartRatePost && body && 'heartRateSamples' in body) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
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
    for (let d = 1; d <= 60; d++) if (syncWindowIso(today(), d, TZ).startIso === start) return d
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

  const hr = (day: string, origin: string) => ({
    type: 'HeartRateSeries', time: new Date(noonOf(day)).toISOString(), origin, id: `hr-${origin}-${day}`,
    samples: [{ time: new Date(noonOf(day)).toISOString(), beatsPerMinute: 60 }],
  })

  it('keeps the marker when the heart-rate upload fails during the rewind, and clears it on a clean one', async () => {
    hc.records = [weight(shiftDateStr(today(), -3), OURA_APP_PACKAGE), hr(shiftDateStr(today(), -3), SAMSUNG)]
    connected(true)
    await syncHealthConnect(TZ)
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(true)

    connected(false)
    failHeartRatePost = true
    const failed = await syncHealthConnect(TZ)
    expect(failed?.failed).toBe(true)
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(true)

    failHeartRatePost = false
    hc.readRecords.mockClear()
    await syncHealthConnect(TZ)
    expect(daysBackOf(firstReadStart())).toBeGreaterThan(7 - 1)
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(false)
  })

  it('keeps the marker when a Health Connect read fails during the rewind', async () => {
    hc.records = [weight(shiftDateStr(today(), -3), OURA_APP_PACKAGE)]
    connected(true)
    await syncHealthConnect(TZ)
    connected(false)
    hc.failRead = 'Weight'
    const r = await syncHealthConnect(TZ)
    expect(r?.incomplete).toBe(true)
    expect(store.has(SKIPPED_SINCE_KEY)).toBe(true)
  })

  it('reaches back to the marker\'s day, never past the cold window and never under the hot one', async () => {
    connected(false)
    store.set(LAST_SYNC_KEY, 'x')
    for (const [ago, expected] of [[12, 13], [100, SYNC_DAYS_COLD], [2, 7]] as const) {
      store.set(SKIPPED_SINCE_KEY, shiftDateStr(today(), -ago))
      hc.readRecords.mockClear()
      await syncHealthConnect(TZ)
      expect(daysBackOf(firstReadStart())).toBe(expected)
    }
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
