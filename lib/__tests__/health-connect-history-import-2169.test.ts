// issue 2169 - Health Connect "Import more history": the paging logic and its device wiring.
//
// The plugin only runs on the phone, so the wiring half drives `importMoreHistory` with the plugin,
// Capacitor and `fetch` stubbed (the pattern of health-connect-heart-rate-sync.test.ts). What the
// phone's Health Connect really returns for a year-old window is the Dev-app device check.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hc = vi.hoisted(() => ({
  /** A Weight record per local day, keyed by the window's start instant -> returns records inside it. */
  weights: [] as Array<{ time: string; value: number }>,
  readRecords: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: ['Weight'] }),
    aggregateRecords: async () => ({ aggregates: [] }),
    readRecords: hc.readRecords,
  },
}))

import {
  runHistoryImport, importMoreHistory, coldSyncOldestDay, historyFloor, historyDayRejection,
  formatImportedTo, importEndMessage, importPastToleranceStartMs,
  HISTORY_WINDOW_DAYS, HISTORY_MAX_DAYS, HISTORY_REQUEST_SPACING_MS,
  type HistoryWindow, type HistoryWindowResult, type HistoryImportDeps,
} from '../health-connect-history-import'
import { shiftDateStr, todayInTz, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-09'

function deps(over: Partial<HistoryImportDeps> & { results?: HistoryWindowResult[] } = {}) {
  const windows: HistoryWindow[] = []
  const saved: string[] = []
  const results = [...(over.results ?? [])]
  const d: HistoryImportDeps = {
    today: TODAY,
    oldest: null,
    importWindow: async w => { windows.push(w); return results.shift() ?? { empty: true } },
    saveOldest: async date => { saved.push(date) },
    shouldStop: () => false,
    sleep: async () => {},
    ...over,
  }
  return { d, windows, saved }
}

describe('runHistoryImport - the paging', () => {
  it('starts below the cold-sync window and goes 30 days older each window', async () => {
    const { d, windows, saved } = deps({ results: [{ empty: false }, { empty: false }, { empty: false }] })
    const out = await runHistoryImport(d)

    const coldOldest = coldSyncOldestDay(TODAY)
    expect(coldOldest).toBe('2026-09-10') // the oldest day a cold sync (30 days, today included) covers
    expect(windows[0]).toEqual({ fromDate: shiftDateStr(coldOldest, -30), toDate: shiftDateStr(coldOldest, -1) })
    // contiguous, no gap and no overlap, each older than the one before
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].toDate).toBe(shiftDateStr(windows[i - 1].fromDate, -1))
      expect(windows[i].fromDate < windows[i - 1].fromDate).toBe(true)
    }
    expect(windows.map(w => w.fromDate).slice(0, 3)).toEqual(saved)
    expect(out).toMatchObject({ windows: 3, end: 'exhausted', oldest: saved[2] })
  })

  it('every window spans exactly 30 days', async () => {
    const { d, windows } = deps({ results: [{ empty: false }, { empty: false }] })
    await runHistoryImport(d)
    for (const w of windows) {
      const days = (Date.parse(w.toDate) - Date.parse(w.fromDate)) / 86_400_000 + 1
      expect(days).toBe(HISTORY_WINDOW_DAYS)
    }
  })

  it('stops when Health Connect returns nothing, and does not move the saved day for the empty window', async () => {
    const { d, windows, saved } = deps({ results: [{ empty: false }, { empty: true }] })
    const out = await runHistoryImport(d)
    expect(windows).toHaveLength(2)
    expect(saved).toHaveLength(1)
    expect(out.end).toBe('exhausted')
    expect(out.oldest).toBe(saved[0])
  })

  it('resumes from the stored oldest day, not from the cold window', async () => {
    const { d, windows } = deps({ oldest: '2026-03-15', results: [{ empty: false }] })
    await runHistoryImport(d)
    expect(windows[0]).toEqual({ fromDate: '2026-02-13', toDate: '2026-03-14' })
  })

  it('a second press continues where the first stopped', async () => {
    let stored: string | null = null
    const first = deps({
      results: [{ empty: false }, { empty: false }, { empty: false }],
      saveOldest: async date => { stored = date },
    })
    let n = 0
    first.d.shouldStop = () => n++ >= 2 // stop after two windows
    const out1 = await runHistoryImport(first.d)
    expect(out1).toMatchObject({ windows: 2, end: 'stopped', oldest: stored })

    const second = deps({ oldest: stored, results: [{ empty: false }] })
    await runHistoryImport(second.d)
    // the first window of the second press picks up the day before where the first press ended
    expect(second.windows[0].toDate).toBe(shiftDateStr(stored!, -1))
    expect(second.windows[0].toDate).toBe(shiftDateStr(first.windows[1].fromDate, -1))
  })

  it('stops promptly when the user stops, before reading another window', async () => {
    const { d, windows } = deps({ shouldStop: () => true })
    const out = await runHistoryImport(d)
    expect(windows).toHaveLength(0)
    expect(out).toMatchObject({ windows: 0, end: 'stopped', oldest: null })
  })

  it('a failed window leaves the stored day where it was and says why', async () => {
    const { d, saved } = deps({ oldest: '2026-03-15', results: [{ empty: false, failed: true, note: 'heart rate stopped at sync-health 429' }] })
    const out = await runHistoryImport(d)
    expect(saved).toEqual([])
    expect(out).toMatchObject({ end: 'failed', error: 'heart rate stopped at sync-health 429', oldest: '2026-03-15' })
  })

  it('a thrown window is a failed run, not a crash', async () => {
    const { d, saved } = deps({ importWindow: async () => { throw new Error('sync-health 500: boom') } })
    const out = await runHistoryImport(d)
    expect(saved).toEqual([])
    expect(out).toMatchObject({ end: 'failed', error: 'sync-health 500: boom' })
  })

  it('does not count a window as imported when saving the day fails (it is re-read next press)', async () => {
    const { d } = deps({ results: [{ empty: false }], saveOldest: async () => { throw new Error('history-import 500') } })
    const out = await runHistoryImport(d)
    expect(out).toMatchObject({ end: 'failed', windows: 0, oldest: null })
  })

  it('imports before it saves, so a crash between the two re-reads a window rather than skipping one', async () => {
    const order: string[] = []
    const { d } = deps({
      results: [{ empty: false }],
      importWindow: async () => { order.push('import'); return order.length > 2 ? { empty: true } : { empty: false } },
      saveOldest: async () => { order.push('save') },
    })
    await runHistoryImport(d)
    expect(order.slice(0, 2)).toEqual(['import', 'save'])
  })

  it('stops at the ten-year limit instead of walking back forever', async () => {
    const floor = historyFloor(TODAY)
    const { d, windows } = deps({ oldest: shiftDateStr(floor, 40), results: Array.from({ length: 10 }, () => ({ empty: false })) })
    const out = await runHistoryImport(d)
    expect(out.end).toBe('limit')
    expect(windows.at(-1)!.fromDate >= floor).toBe(true)
    expect(out.oldest).toBe(floor)
    expect(HISTORY_MAX_DAYS).toBe(3650)
  })

  it('paces itself against the route rate limit: a busy window waits, a quiet one does not', async () => {
    const sleeps: number[] = []
    let t = 0
    const { d } = deps({
      results: [{ empty: false, requests: 41 }, { empty: false, requests: 1 }, { empty: true }],
      sleep: async ms => { sleeps.push(ms); t += ms },
      now: () => t,
    })
    await runHistoryImport(d)
    expect(sleeps[0]).toBe(41 * HISTORY_REQUEST_SPACING_MS)
    expect(sleeps[1]).toBe(1 * HISTORY_REQUEST_SPACING_MS)
  })
})

describe('helpers', () => {
  it('formats "Imported to" as "12 Jun" this year and with the year otherwise, with no zone drift', () => {
    expect(formatImportedTo('2026-06-12', TODAY)).toBe('12 Jun')
    expect(formatImportedTo('2025-01-01', TODAY)).toBe('1 Jan 2025')
    expect(formatImportedTo('2026-01-01', TODAY)).toBe('1 Jan')
  })

  it('rejects a claimed day that is not real, in the future, or older than an import goes', () => {
    expect(historyDayRejection('2026-06-12', TODAY)).toBeNull()
    expect(historyDayRejection(TODAY, TODAY)).toBeNull()
    expect(historyDayRejection('2026-99-99', TODAY)).toMatch(/not a real calendar date/)
    expect(historyDayRejection('2026/06/12', TODAY)).toBeNull() // slashes are a date too
    expect(historyDayRejection('2026/99/99', TODAY)).toMatch(/not a real calendar date/)
    expect(historyDayRejection('2026-10-10', TODAY)).toMatch(/after today/)
    expect(historyDayRejection('1999-01-01', TODAY)).toMatch(/older than/)
  })

  it('the tolerance start for a window is its first day\'s local midnight, less a day of slack', () => {
    expect(importPastToleranceStartMs('2026-06-12', TZ)).toBe(dateStrMidnightInTz('2026-06-11', TZ).getTime())
  })

  it('words each ending in plain English', () => {
    const o = { oldest: '2026-06-12', windows: 2 }
    expect(importEndMessage({ ...o, end: 'exhausted' }, TODAY)).toBe('Imported to 12 Jun. Health Connect has nothing older.')
    expect(importEndMessage({ ...o, end: 'stopped' }, TODAY)).toBe('Stopped. Imported to 12 Jun.')
    expect(importEndMessage({ ...o, end: 'failed', error: 'x' }, TODAY)).toContain('Press again to continue.')
    expect(importEndMessage({ oldest: null, windows: 0, end: 'exhausted' }, TODAY)).toBe('Health Connect has nothing older to import.')
  })
})

// ── Device wiring ─────────────────────────────────────────────────────────────────────────────────

type Call = { url: string; method: string; body: Record<string, unknown> | null }
const calls: Call[] = []
let serverOldest: string | null = null
let failNextSync = false

function installFetch() {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) as Record<string, unknown> : null
    calls.push({ url, method, body })
    if (url === '/api/health-connect/history-import') {
      if (method === 'POST') {
        const d = body!.oldestDate as string
        serverOldest = serverOldest && serverOldest < d ? serverOldest : d
        return { ok: true, status: 200, json: async () => ({ oldestDate: serverOldest }), text: async () => '' }
      }
      return { ok: true, status: 200, json: async () => ({ oldestDate: serverOldest }), text: async () => '' }
    }
    if (failNextSync) { failNextSync = false; return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } }
    return { ok: true, status: 200, json: async () => ({ enrichmentCandidates: [] }), text: async () => '' }
  }))
}

/** Weight records exist for the 75 days before the cold window and nothing older. */
function seedWeights() {
  const today = todayInTz(TZ)
  const cold = coldSyncOldestDay(today)
  hc.weights = []
  for (let i = 1; i <= 75; i++) {
    const day = shiftDateStr(cold, -i)
    hc.weights.push({ time: dateStrMidnightInTz(day, TZ).toISOString().replace(/T.*/, 'T02:00:00.000Z'), value: 80 + i / 100 })
  }
}

beforeEach(() => {
  serverOldest = null
  failNextSync = false
  seedWeights()
  hc.readRecords.mockReset()
  hc.readRecords.mockImplementation(async ({ start, end, type }: { start: string; end: string; type: string }) => ({
    records: type === 'Weight' ? hc.weights.filter(r => r.time >= start && r.time < end) : [],
  }))
  installFetch()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

const syncPosts = () => calls.filter(c => c.url === '/api/sync-health')
const savePosts = () => calls.filter(c => c.url === '/api/health-connect/history-import' && c.method === 'POST')

describe('importMoreHistory - on the device', () => {
  it('reads Health Connect a window at a time, sends each through /api/sync-health tagged historyFrom, and stops on an empty window', async () => {
    const out = await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })

    // 75 days of data = windows of 30, 30, 15 days with data, then a window with none
    expect(out).toMatchObject({ end: 'exhausted', windows: 3 })
    const posts = syncPosts()
    expect(posts).toHaveLength(3)
    for (const p of posts) {
      expect(typeof p.body!.historyFrom).toBe('string')
      expect(Object.keys(p.body!).sort()).toEqual(['dailyMetrics', 'exerciseSessions', 'historyFrom', 'sleepRecords'])
    }
    // each window's first day is the historyFrom it announces, and they walk older
    const froms = posts.map(p => p.body!.historyFrom as string)
    expect([...froms].sort().reverse()).toEqual(froms)
    // progress is saved after each window, oldest day only
    expect(savePosts().map(c => c.body!.oldestDate)).toEqual(froms)
    expect(out!.oldest).toBe(froms[2])
  })

  it('only ever writes through /api/sync-health - the ranked-merge path live sync uses', async () => {
    await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    const urls = new Set(calls.map(c => c.url))
    expect([...urls].sort()).toEqual(['/api/health-connect/history-import', '/api/sync-health'])
  })

  it('is idempotent: running again from the same stored day sends the same payloads', async () => {
    await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    const first = syncPosts().map(p => JSON.stringify(p.body))

    serverOldest = null // as if the cursor save had been lost - the window is read again
    installFetch()
    await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    expect(syncPosts().map(p => JSON.stringify(p.body))).toEqual(first)
  })

  it('a second press continues from the stored oldest day', async () => {
    let n = 0
    const out1 = await importMoreHistory({ tz: TZ, shouldStop: () => n++ >= 1, sleep: async () => {} }) // one window, then stop
    expect(out1).toMatchObject({ end: 'stopped', windows: 1 })
    const stoppedAt = serverOldest!
    expect(stoppedAt).toBe(out1!.oldest)

    installFetch()
    const out2 = await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    expect(out2!.windows).toBeGreaterThan(0)
    const secondFirstFrom = syncPosts()[0].body!.historyFrom as string
    expect(secondFirstFrom).toBe(shiftDateStr(stoppedAt, -30))
    expect(calls[0]).toMatchObject({ url: '/api/health-connect/history-import', method: 'GET' })
  })

  it('does not advance past a window whose upload failed', async () => {
    failNextSync = true
    const out = await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    expect(out).toMatchObject({ end: 'failed', windows: 0 })
    expect(savePosts()).toHaveLength(0)
    expect(serverOldest).toBeNull()
  })

  it('reads the window in the user\'s local midnights', async () => {
    await importMoreHistory({ tz: TZ, shouldStop: () => false, sleep: async () => {} })
    const first = hc.readRecords.mock.calls.find(c => c[0].type === 'Weight')![0] as { start: string; end: string }
    const from = syncPostsFirstFrom()
    expect(first.start).toBe(dateStrMidnightInTz(from, TZ).toISOString())
    expect(first.end).toBe(dateStrMidnightInTz(shiftDateStr(coldSyncOldestDay(todayInTz(TZ)), 0), TZ).toISOString())
  })
})

function syncPostsFirstFrom(): string {
  return syncPosts()[0].body!.historyFrom as string
}
