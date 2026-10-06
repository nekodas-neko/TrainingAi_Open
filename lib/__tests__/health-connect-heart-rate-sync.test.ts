// #2168 — Health Connect's HeartRateSeries reaches /api/sync-health as a sample list.
//
// The plugin only runs on the phone, so this drives `syncHealthConnect` with the plugin, Capacitor
// and `fetch` stubbed. The record shape below is the patched converter's (LA-115): a record with
// `samples[]` of `{ time, beatsPerMinute }`, `time` being `Instant.toString()`. What the phone
// actually returns is the device check; this pins what the code does with that shape.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hc = vi.hoisted(() => ({
  granted: [] as string[],
  records: {} as Record<string, unknown[]>,
  readRecords: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: hc.granted }),
    aggregateRecords: async () => ({ aggregates: [] }),
    readRecords: hc.readRecords,
  },
}))

import {
  syncHealthConnect, flattenHeartRateRecords, chunkHeartRateSamples,
  HR_UPLOAD_CHUNK, HR_UPLOAD_MAX_CHUNKS, type HeartRateSample,
} from '../health-connect-sync'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
/** A HeartRateSeries record as the patched converter emits it. */
const hrRecord = (times: number[], bpm = 72) => ({
  startTime: iso(times[0]), endTime: iso(times[times.length - 1]),
  samples: times.map(t => ({ time: iso(t), beatsPerMinute: bpm })),
  metadata: { id: 'r', dataOrigin: 'com.example.watch' },
})

const fetchMock = vi.fn()
const bodies = () => fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string))

beforeEach(() => {
  hc.granted = ['HeartRateSeries']
  hc.records = {}
  hc.readRecords.mockReset()
  hc.readRecords.mockImplementation(async ({ type }: { type: string }) => ({ records: hc.records[type] ?? [] }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ enrichmentCandidates: [] }), text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
  const store = new Map<string, string>([['ta_hc_last_sync', 'x']])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})

describe('flattenHeartRateRecords', () => {
  it('reads every sample of every record, newest first, as epoch ms', () => {
    const now = Date.now()
    const out = flattenHeartRateRecords([hrRecord([now - 2 * HOUR, now - HOUR], 70), hrRecord([now - 30_000], 95)])
    expect(out).toEqual([
      { at: now - 30_000, bpm: 95 },
      { at: now - HOUR, bpm: 70 },
      { at: now - 2 * HOUR, bpm: 70 },
    ])
  })

  it('skips what the pre-LA-115 plugin returned — a toString() blob — instead of reading undefined', () => {
    expect(flattenHeartRateRecords(['HeartRateRecord(startTime=…, samples=[…])', null, {}])).toEqual([])
  })

  it('drops a sample whose time does not parse or whose bpm is not a finite number', () => {
    const now = Date.now()
    const out = flattenHeartRateRecords([{
      samples: [
        { time: 'not a time', beatsPerMinute: 70 },
        { time: iso(now), beatsPerMinute: '70' },
        { time: iso(now), beatsPerMinute: null },
        { time: iso(now - 1000), beatsPerMinute: 71 },
      ],
    }])
    expect(out).toEqual([{ at: now - 1000, bpm: 71 }])
  })
})

describe('chunkHeartRateSamples', () => {
  const samples = (n: number): HeartRateSample[] => Array.from({ length: n }, (_, i) => ({ at: i, bpm: 60 }))

  it('splits into request-sized chunks', () => {
    expect(chunkHeartRateSamples(samples(25), 10, 5).map(c => c.length)).toEqual([10, 10, 5])
  })

  it('keeps at most the cap, from the front (the newest, once flattened)', () => {
    const out = chunkHeartRateSamples(samples(100), 10, 3)
    expect(out.map(c => c.length)).toEqual([10, 10, 10])
    expect(out[0][0].at).toBe(0)
  })
})

describe('syncHealthConnect — the heart-rate series', () => {
  it('posts the series as heartRateSamples, and skips the daily post when there is nothing else', async () => {
    const now = Date.now()
    hc.records.HeartRateSeries = [hrRecord([now - 3 * HOUR, now - 2 * HOUR, now - HOUR], 81)]

    const result = await syncHealthConnect(TZ)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sync-health')
    expect(bodies()[0]).toEqual({
      heartRateSamples: [{ at: now - HOUR, bpm: 81 }, { at: now - 2 * HOUR, bpm: 81 }, { at: now - 3 * HOUR, bpm: 81 }],
    })
    expect(result).toMatchObject({ heartRate: 3 })
  })

  it('sends the daily payload first and unchanged, then the series on its own', async () => {
    const now = Date.now()
    hc.granted = ['HeartRateSeries', 'Weight']
    hc.records.Weight = [{ time: iso(now - HOUR), value: 81.2 }]
    hc.records.HeartRateSeries = [hrRecord([now - HOUR])]

    await syncHealthConnect(TZ)

    const [daily, hr] = bodies()
    expect(Object.keys(daily).sort()).toEqual(['dailyMetrics', 'exerciseSessions', 'sleepRecords'])
    expect(daily.dailyMetrics[0].weightKg).toBe(81.2)
    expect(hr).toEqual({ heartRateSamples: [{ at: now - HOUR, bpm: 72 }] })
  })

  it('does not read the series without the permission', async () => {
    hc.granted = []
    hc.records.HeartRateSeries = [hrRecord([Date.now() - HOUR])]
    const result = await syncHealthConnect(TZ)
    expect(hc.readRecords).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ heartRate: 0, note: 'no data from HC' })
  })

  it('stops at the first failed chunk and says so, without throwing', async () => {
    const now = Date.now()
    hc.records.HeartRateSeries = [hrRecord(Array.from({ length: HR_UPLOAD_CHUNK + 5 }, (_, i) => now - i * 1000))]
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' }))

    const result = await syncHealthConnect(TZ)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ heartRate: 0, note: 'heart rate stopped at sync-health 429' })
  })

  it('caps the requests per sync, sending the newest samples', async () => {
    const now = Date.now()
    const n = HR_UPLOAD_CHUNK * (HR_UPLOAD_MAX_CHUNKS + 2)
    hc.records.HeartRateSeries = [hrRecord(Array.from({ length: n }, (_, i) => now - i * 100))]

    const result = await syncHealthConnect(TZ)

    expect(fetchMock).toHaveBeenCalledTimes(HR_UPLOAD_MAX_CHUNKS)
    expect(bodies()[0].heartRateSamples[0]).toEqual({ at: now, bpm: 72 })
    expect(result).toMatchObject({ heartRate: HR_UPLOAD_CHUNK * HR_UPLOAD_MAX_CHUNKS })
    expect(result?.note).toContain(`${HR_UPLOAD_CHUNK * 2} older samples`)
  })
})
