// #2462 — Health Connect steps, active calories and cadence reach /api/sync-health per interval.
//
// The plugin only runs on the phone, so this drives `syncHealthConnect` with the plugin, Capacitor
// and `fetch` stubbed. The record shapes are the patched converter's: `StepsRecord` →
// `{ startTime, endTime, count }`, `ActiveCaloriesBurnedRecord` → `{ startTime, endTime,
// kilocalories }`, `StepsCadenceRecord` → `{ samples: [{ time, rate }] }`, each with `metadata.{ id,
// dataOrigin, device.type }` (la115-hc-record-converter.test.ts pins those keys in the converter).
// What the phone actually returns is the device check; this pins what the code does with the shape.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hc = vi.hoisted(() => ({
  granted: [] as string[],
  requested: [] as string[],
  records: {} as Record<string, unknown[]>,
  failing: new Set<string>(),
  readRecords: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async ({ read }: { read: string[] }) => { hc.requested = read; return { read: hc.granted } },
    aggregateRecords: async () => ({ aggregates: [] }),
    readRecords: hc.readRecords,
  },
}))

import {
  syncHealthConnect, flattenIntervalRecords, flattenCadenceRecords,
  INTERVAL_UPLOAD_CHUNK, INTERVAL_UPLOAD_MAX_CHUNKS,
} from '../health-connect-sync'

const TZ = 'Australia/Brisbane'
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const meta = (id: string, type: string | null = 'TYPE_WATCH') =>
  ({ id, dataOrigin: 'com.sec.android.app.shealth', device: type ? { manufacturer: 'Samsung', model: 'SM-R960', type } : null })
const stepsRecord = (id: string, start: number, mins: number, count: number) =>
  ({ startTime: iso(start), endTime: iso(start + mins * MIN), count, metadata: meta(id) })
const kcalRecord = (id: string, start: number, mins: number, kilocalories: number) =>
  ({ startTime: iso(start), endTime: iso(start + mins * MIN), kilocalories, metadata: meta(id, 'TYPE_PHONE') })
const cadenceRecord = (id: string, times: number[], rate = 112) =>
  ({ startTime: iso(times[0]), endTime: iso(times[times.length - 1]), samples: times.map(t => ({ time: iso(t), rate })), metadata: meta(id, null) })

const fetchMock = vi.fn()
const bodies = () => fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string))

beforeEach(() => {
  hc.granted = ['Steps', 'ActiveCaloriesBurned']
  hc.requested = []
  hc.records = {}
  hc.failing = new Set()
  hc.readRecords.mockReset()
  hc.readRecords.mockImplementation(async ({ type }: { type: string }) => {
    if (hc.failing.has(type)) throw new Error(`${type} unavailable`)
    return { records: hc.records[type] ?? [] }
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ enrichmentCandidates: [] }), text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const store = new Map<string, string>([['ta_hc_last_sync', 'x']])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})

describe('flattenIntervalRecords', () => {
  it('reads steps and active kcal records as rows, newest first, keyed by the record id', () => {
    const t = Date.now() - 60 * MIN
    expect(flattenIntervalRecords('steps', [stepsRecord('a', t, 1, 90), stepsRecord('b', t + 5 * MIN, 1, 101)])).toEqual([
      { kind: 'steps', startMs: t + 5 * MIN, endMs: t + 6 * MIN, value: 101, recordId: 'b', origin: 'com.sec.android.app.shealth', device: 'TYPE_WATCH' },
      { kind: 'steps', startMs: t, endMs: t + MIN, value: 90, recordId: 'a', origin: 'com.sec.android.app.shealth', device: 'TYPE_WATCH' },
    ])
    expect(flattenIntervalRecords('active_kcal', [kcalRecord('k', t, 10, 42.7)])).toEqual([
      { kind: 'active_kcal', startMs: t, endMs: t + 10 * MIN, value: 42.7, recordId: 'k', origin: 'com.sec.android.app.shealth', device: 'TYPE_PHONE' },
    ])
  })

  it('keeps a zero count — a real reading, not an absent one', () => {
    expect(flattenIntervalRecords('steps', [stepsRecord('z', Date.now() - MIN, 1, 0)])[0].value).toBe(0)
  })

  it('drops what it cannot place instead of sending undefined or NaN', () => {
    const t = Date.now() - 10 * MIN
    expect(flattenIntervalRecords('steps', [
      'StepsRecord(startTime=…)',                                     // the pre-converter toString() blob
      null,
      { ...stepsRecord('a', t, 1, 10), metadata: { id: '' } },       // no record id to key on
      { ...stepsRecord('b', t, 1, 10), startTime: 'not a time' },
      { ...stepsRecord('c', t, 1, 10), count: '10' },
      kcalRecord('d', t, 1, 5),                                      // kcal record read as steps: no `count`
    ])).toEqual([])
  })

  it('omits origin and device when the source app recorded neither', () => {
    const t = Date.now() - 10 * MIN
    const [row] = flattenIntervalRecords('steps', [{ startTime: iso(t), endTime: iso(t + MIN), count: 5, metadata: { id: 'x', device: null } }])
    expect(row).toEqual({ kind: 'steps', startMs: t, endMs: t + MIN, value: 5, recordId: 'x' })
  })
})

describe('flattenCadenceRecords', () => {
  it('reads every sample as an instant row carrying its record id, newest first', () => {
    const t = Date.now() - 10 * MIN
    expect(flattenCadenceRecords([cadenceRecord('c1', [t, t + 1000], 110)])).toEqual([
      { kind: 'cadence_spm', startMs: t + 1000, endMs: t + 1000, value: 110, recordId: 'c1', origin: 'com.sec.android.app.shealth' },
      { kind: 'cadence_spm', startMs: t, endMs: t, value: 110, recordId: 'c1', origin: 'com.sec.android.app.shealth' },
    ])
  })

  it('drops a sample whose time does not parse or whose rate is not a finite number', () => {
    const t = Date.now() - MIN
    const out = flattenCadenceRecords([{
      metadata: { id: 'c' },
      samples: [{ time: 'x', rate: 100 }, { time: iso(t), rate: '100' }, { time: iso(t), rate: null }, { time: iso(t), rate: 104 }],
    }, { samples: [{ time: iso(t), rate: 100 }] /* no id */ }])
    expect(out).toEqual([{ kind: 'cadence_spm', startMs: t, endMs: t, value: 104, recordId: 'c' }])
  })

  it('reads nothing from an APK without the #2462 converters, where these records are toString() blobs', () => {
    // The JS ships with a release; the converter ships with an APK. Until that APK is installed the
    // plugin returns Kotlin strings for ActiveCaloriesBurned and StepsCadenceSeries, and the sync
    // must send nothing for them rather than garbage.
    expect(flattenCadenceRecords(['StepsCadenceRecord(startTime=…, samples=[…])'])).toEqual([])
    expect(flattenIntervalRecords('active_kcal', ['ActiveCaloriesBurnedRecord(startTime=…, energy=…)'])).toEqual([])
  })
})

describe('syncHealthConnect — per-interval movement', () => {
  it('requests ActiveCaloriesBurned, and never StepsCadenceSeries (it reads under the Steps grant)', async () => {
    await syncHealthConnect(TZ)
    expect(hc.requested).toContain('ActiveCaloriesBurned')
    expect(hc.requested).not.toContain('StepsCadenceSeries')
  })

  it('posts all three kinds in a request of their own, newest first', async () => {
    const t = Date.now() - 60 * MIN
    hc.records.Steps = [stepsRecord('s', t, 1, 90)]
    hc.records.ActiveCaloriesBurned = [kcalRecord('k', t + 10 * MIN, 5, 20)]
    hc.records.StepsCadenceSeries = [cadenceRecord('c', [t + 20 * MIN])]

    const result = await syncHealthConnect(TZ)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [body] = bodies()
    expect(Object.keys(body)).toEqual(['activityIntervals'])
    expect(body.activityIntervals.map((r: { kind: string; recordId: string }) => `${r.kind}:${r.recordId}`))
      .toEqual(['cadence_spm:c', 'active_kcal:k', 'steps:s'])
    expect(result).toMatchObject({ intervals: 3, heartRate: 0 })
  })

  it('reads steps and cadence on the Steps grant, active kcal only on its own', async () => {
    hc.granted = ['Steps']
    await syncHealthConnect(TZ)
    const types = hc.readRecords.mock.calls.map(c => (c[0] as { type: string }).type)
    expect(types).toEqual(expect.arrayContaining(['Steps', 'StepsCadenceSeries']))
    expect(types).not.toContain('ActiveCaloriesBurned')

    hc.readRecords.mockClear()
    hc.granted = ['ActiveCaloriesBurned']
    await syncHealthConnect(TZ)
    expect(hc.readRecords.mock.calls.map(c => (c[0] as { type: string }).type)).toEqual(['ActiveCaloriesBurned'])
  })

  it('one failing read does not cost the others', async () => {
    const t = Date.now() - 30 * MIN
    hc.failing.add('StepsCadenceSeries')
    hc.records.Steps = [stepsRecord('s', t, 1, 90)]
    hc.records.ActiveCaloriesBurned = [kcalRecord('k', t, 1, 3)]
    const result = await syncHealthConnect(TZ)
    expect(result).toMatchObject({ intervals: 2 })
    expect(console.warn).toHaveBeenCalledWith('[health-connect] StepsCadenceSeries read failed:', expect.any(Error))
  })

  it('caps the requests per sync, sending the newest rows, and says what it left', async () => {
    const t = Date.now() - 60 * MIN
    const n = INTERVAL_UPLOAD_CHUNK * (INTERVAL_UPLOAD_MAX_CHUNKS + 1)
    hc.records.StepsCadenceSeries = [cadenceRecord('c', Array.from({ length: n }, (_, i) => t - i * 10))]

    const result = await syncHealthConnect(TZ)

    expect(fetchMock).toHaveBeenCalledTimes(INTERVAL_UPLOAD_MAX_CHUNKS)
    expect(bodies()[0].activityIntervals[0].startMs).toBe(t)
    expect(result).toMatchObject({ intervals: INTERVAL_UPLOAD_CHUNK * INTERVAL_UPLOAD_MAX_CHUNKS })
    expect(result?.note).toBe(`intervals: ${INTERVAL_UPLOAD_CHUNK} older rows over the per-sync cap`)
  })

  it('stops at the first failed chunk and says so, without throwing', async () => {
    hc.records.Steps = [stepsRecord('s', Date.now() - 30 * MIN, 1, 90)]
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '' }))
    const result = await syncHealthConnect(TZ)
    expect(result).toMatchObject({ intervals: 0, note: 'intervals stopped at sync-health 429' })
  })
})
