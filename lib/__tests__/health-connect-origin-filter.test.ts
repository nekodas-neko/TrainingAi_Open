// #3115 part 2: while Oura Cloud is connected, the current app's Health Connect sync leaves the Oura
// app's own records out and counts them. Driven through the real `syncWindow` with a fake plugin and
// a stubbed `/api/sync-health`, so what is asserted is what would be uploaded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HealthConnectPlugin } from '@devmaxime/capacitor-health-connect'

const cache = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/sqlite/cache', () => ({ readCacheSync: () => cache.value }))

import { syncWindow, HC_SYNC_READ_TYPES } from '../health-connect-sync'
import { OURA_APP_PACKAGE } from '@trainingai/shared/health/health-connect-origin'
import { todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const START = '2026-10-10T14:00:00.000Z'
const END = '2026-10-12T14:00:00.000Z'
const SAMSUNG = 'com.sec.android.app.shealth'

// One record of every type the sync reads, from `origin` (undefined: no metadata at all).
function recordsFrom(origin: string | undefined, tag = origin ?? 'none'): Record<string, unknown[]> {
  const meta = (id: string) => ({ metadata: { id: `${tag}-${id}`, ...(origin ? { dataOrigin: origin } : {}) } })
  return {
    Weight: [{ time: '2026-10-11T21:00:00Z', value: 80, ...meta('w') }],
    BodyFat: [{ time: '2026-10-11T21:00:00Z', percentage: 15, ...meta('bf') }],
    Nutrition: [{ startTime: '2026-10-11T02:00:00Z', calories: 500, ...meta('n') }],
    RestingHeartRate: [{ time: '2026-10-11T20:00:00Z', beatsPerMinute: 50, ...meta('rhr') }],
    // 04:00 in Brisbane: inside the overnight window both means use.
    HeartRateVariabilityRmssd: [{ time: '2026-10-11T18:00:00Z', heartRateVariabilityMillis: 60, ...meta('hrv') }],
    OxygenSaturation: [{ time: '2026-10-11T18:00:00Z', percentage: 97, ...meta('spo2') }],
    ActivitySession: [{ startTime: '2026-10-11T07:00:00Z', endTime: '2026-10-11T08:00:00Z', exerciseType: 'RUNNING', ...meta('ex') }],
    SleepSession: [{ startTime: '2026-10-11T12:00:00Z', endTime: '2026-10-11T20:00:00Z', stages: [], ...meta('sleep') }],
    HeartRateSeries: [{ samples: [{ time: '2026-10-11T07:30:00Z', beatsPerMinute: origin === OURA_APP_PACKAGE ? 150 : 120 }], ...meta('hr') }],
    Steps: [{ startTime: '2026-10-11T03:00:00Z', endTime: '2026-10-11T04:00:00Z', count: 900, ...meta('steps') }],
    StepsCadenceSeries: [{ samples: [{ time: '2026-10-11T03:10:00Z', rate: 110 }], ...meta('cad') }],
    ActiveCaloriesBurned: [{ startTime: '2026-10-11T03:00:00Z', endTime: '2026-10-11T04:00:00Z', kilocalories: 40, ...meta('kcal') }],
  }
}
const READ_TYPES = Object.keys(recordsFrom(undefined))

function session(...sets: Record<string, unknown[]>[]) {
  const HealthConnect = {
    readRecords: vi.fn(async ({ type }: { type: string }) => ({ records: sets.flatMap(s => s[type] ?? []) })),
    aggregateRecords: vi.fn(async () => ({ aggregates: [] })),
  } as unknown as HealthConnectPlugin
  return { HealthConnect, canRead: new Set<string>(HC_SYNC_READ_TYPES) }
}

let posted: Record<string, unknown>[] = []
beforeEach(() => {
  posted = []
  cache.value = null
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body))
    return new Response(JSON.stringify({}), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const daily = () => posted.find(b => 'dailyMetrics' in b) as
  { dailyMetrics: Record<string, unknown>[]; exerciseSessions: Record<string, unknown>[]; sleepRecords: unknown[] } | undefined
const series = (field: string) => posted.flatMap(b => (b[field] as unknown[] | undefined) ?? [])

describe('Health Connect origin filter, current app (#3115)', () => {
  it('skips every type the Oura app wrote while Oura Cloud is connected, and counts each', async () => {
    const r = await syncWindow(session(recordsFrom(OURA_APP_PACKAGE)), TZ, START, END, { firstHand: { ouraCloud: true } })
    expect(posted).toEqual([])
    expect(r.skippedFirstHand).toEqual(Object.fromEntries(READ_TYPES.map(t => [t, 1])))
    expect(r).toMatchObject({ metrics: 0, sessions: 0, sleep: 0, heartRate: 0, intervals: 0 })
  })

  it("keeps the Oura app's records when Oura Cloud is not connected, or not known", async () => {
    for (const firstHand of [{ ouraCloud: false }, null]) {
      posted = []
      const r = await syncWindow(session(recordsFrom(OURA_APP_PACKAGE)), TZ, START, END, { firstHand })
      expect(r.skippedFirstHand).toBeUndefined()
      expect(r).toMatchObject({ sessions: 1, sleep: 1, heartRate: 1, intervals: 3 })
      expect(daily()?.dailyMetrics.length).toBeGreaterThan(0)
    }
  })

  it("never skips another app's records, or a record with no origin", async () => {
    const r = await syncWindow(session(recordsFrom(SAMSUNG), recordsFrom(undefined)), TZ, START, END, { firstHand: { ouraCloud: true } })
    expect(r.skippedFirstHand).toBeUndefined()
    expect(r).toMatchObject({ sessions: 2, heartRate: 2, intervals: 6 })
    expect(series('heartRateSamples')).toHaveLength(2)
  })

  it("leaves Oura's samples out of the per-day means and a workout's heart rate", async () => {
    const r = await syncWindow(session(recordsFrom(SAMSUNG), recordsFrom(OURA_APP_PACKAGE)), TZ, START, END, { firstHand: { ouraCloud: true } })
    expect(r.skippedFirstHand).toEqual(Object.fromEntries(READ_TYPES.map(t => [t, 1])))
    const body = daily()!
    expect(body.exerciseSessions).toHaveLength(1)
    expect(body.exerciseSessions[0]).toMatchObject({ avgHr: 120, maxHr: 120 })
    expect(body.sleepRecords).toHaveLength(1)
    expect(series('heartRateSamples')).toEqual([{ at: Date.parse('2026-10-11T07:30:00Z'), bpm: 120 }])
    expect((series('activityIntervals') as { origin?: string }[]).every(i => i.origin === SAMSUNG)).toBe(true)
  })

  it("reads the connection from today's cached readiness payload when the caller doesn't pass it", async () => {
    const sources = { ring: false, strap: false, healthConnect: true, ouraCloud: true }
    cache.value = { date: todayInTz(TZ), data: { connectedSources: sources } }
    const r = await syncWindow(session(recordsFrom(OURA_APP_PACKAGE)), TZ, START, END)
    expect(r.skippedFirstHand?.SleepSession).toBe(1)
  })

  // #3197: one cold-start rule for both apps. Not known today means keep Oura's copies.
  it.each([
    ['nothing cached (the mirror was cleared)', null],
    ["yesterday's payload", { date: '2000-01-01', data: { connectedSources: { ouraCloud: true } } }],
    ['an older entry stored as the payload itself, with no date', { connectedSources: { ouraCloud: true } }],
    ['a payload with no connection facts', { date: 'today', data: {} }],
  ])('keeps the Oura app\'s records when the connection is unknown: %s', async (_name, value) => {
    cache.value = value && 'date' in value && value.date === 'today' ? { ...value, date: todayInTz(TZ) } : value
    const r = await syncWindow(session(recordsFrom(OURA_APP_PACKAGE)), TZ, START, END)
    expect(r.skippedFirstHand).toBeUndefined()
    expect(r.sleep).toBe(1)
  })
})
