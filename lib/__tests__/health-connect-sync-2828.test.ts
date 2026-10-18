// #2828 — what the current app's Health Connect writer sends to /api/sync-health, driven through
// `syncHealthConnect` with the plugin, Capacitor and `fetch` stubbed. The aggregate shape is the
// pinned plugin's (`AndroidHealthConnect.kt` `aggregateRecords`): one `{ startTime, value }` per day,
// with `?: 0.0` for a day that has no records. What the phone actually returns is the device check.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hc = vi.hoisted(() => ({
  granted: [] as string[],
  aggregates: {} as Record<string, Array<{ startTime: string; value: number }>>,
  records: {} as Record<string, unknown[]>,
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: hc.granted }),
    aggregateRecords: async ({ type }: { type: string }) => ({ aggregates: hc.aggregates[type] ?? [] }),
    readRecords: async ({ type }: { type: string }) => ({ records: hc.records[type] ?? [] }),
  },
}))

import { syncHealthConnect, LAST_SYNC_KEY } from '../health-connect-sync'

const TZ = 'Australia/Brisbane'
const fetchMock = vi.fn()
const bodies = () => fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string))
const store = new Map<string, string>()
const ok = { ok: true, status: 200, json: async () => ({ enrichmentCandidates: [] }), text: async () => '' }

// Local midday (CLAUDE.md: fixtures anchor to local midday), on days inside the hot window.
const day = (back: number) => new Date(Date.now() - back * 86_400_000)
const midday = (back: number) => {
  const d = day(back)
  d.setUTCHours(2, 0, 0, 0) // 12:00 in Brisbane
  return d.toISOString()
}

beforeEach(() => {
  hc.granted = []
  hc.aggregates = {}
  hc.records = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ok)
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  store.clear()
  store.set(LAST_SYNC_KEY, 'x')
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})

describe('#2828 N7 — an empty day\'s distance and total calories write nothing', () => {
  it('skips the plugin\'s 0 for a day with no records and keeps a real reading', async () => {
    hc.granted = ['Steps', 'TotalCaloriesBurned']
    hc.aggregates = {
      Distance: [{ startTime: midday(2), value: 0 }, { startTime: midday(1), value: 4_260 }],
      TotalCaloriesBurned: [{ startTime: midday(2), value: 0 }, { startTime: midday(1), value: 2_310.4 }],
    }
    await syncHealthConnect(TZ)
    const [daily] = bodies()
    expect(daily.dailyMetrics).toHaveLength(1)
    expect(daily.dailyMetrics[0]).toMatchObject({ distanceKm: 4.3, caloriesBurned: 2310 })
  })

  it('sends nothing at all when every day is empty', async () => {
    hc.granted = ['Steps', 'TotalCaloriesBurned']
    hc.aggregates = {
      Distance: [{ startTime: midday(2), value: 0 }],
      TotalCaloriesBurned: [{ startTime: midday(2), value: 0 }],
    }
    const result = await syncHealthConnect(TZ)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result?.note).toBe('no data from HC')
  })
})

describe('#2828 N5/N6 — a watch strength session', () => {
  const session = (title: string) => ({
    startTime: midday(1), endTime: new Date(Date.parse(midday(1)) + 45 * 60_000).toISOString(),
    exerciseType: 'EXERCISE_TYPE_STRENGTH_TRAINING', title,
  })

  it('is sent as strength with a readable name when untitled (the plugin sends "" for no title)', async () => {
    hc.granted = ['ActivitySession']
    hc.records = { ActivitySession: [session('')] }
    await syncHealthConnect(TZ)
    expect(bodies()[0].exerciseSessions[0]).toMatchObject({ title: 'Strength training', activityType: 'strength', durationMin: 45 })
  })

  it('keeps the title the writing app gave it', async () => {
    hc.granted = ['ActivitySession']
    hc.records = { ActivitySession: [session('Push day')] }
    await syncHealthConnect(TZ)
    expect(bodies()[0].exerciseSessions[0].title).toBe('Push day')
  })
})

describe('#2828 N3 — a refused daily payload does not wedge the sync', () => {
  const steps = () => { hc.granted = ['Steps']; hc.aggregates = { Steps: [{ startTime: midday(1), value: 5000 }] } }

  it('notes a 400, marks the window posted and still sends heart rate', async () => {
    steps()
    hc.granted.push('HeartRateSeries')
    hc.records = { HeartRateSeries: [{ samples: [{ time: midday(1), beatsPerMinute: 70 }] }] }
    store.delete(LAST_SYNC_KEY)
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'Invalid payload' }))
    const result = await syncHealthConnect(TZ)
    expect(result?.note).toContain('daily payload refused (sync-health 400)')
    expect(store.get(LAST_SYNC_KEY)).toBeTruthy()
    expect(bodies()[1].heartRateSamples).toHaveLength(1)
  })

  it('still throws on a failure that may pass next time, leaving the window to be re-sent', async () => {
    steps()
    store.delete(LAST_SYNC_KEY)
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }))
    await expect(syncHealthConnect(TZ)).rejects.toThrow('sync-health 503')
    expect(store.has(LAST_SYNC_KEY)).toBe(false)
  })
})
