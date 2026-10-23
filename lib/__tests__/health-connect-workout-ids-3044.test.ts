// #3044: the current app's writer sends each exercise session's record id and source, and the
// window it read in full, so the server can key sessions on the id and tombstone deleted ones.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cache = vi.hoisted(() => ({ value: null as unknown }))
const hc = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; origin: string; startTime: string; endTime: string; exerciseType: string }>,
  failRead: false,
}))

vi.mock('@/lib/sqlite/cache', () => ({ readCacheSync: () => cache.value }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@devmaxime/capacitor-health-connect', () => ({
  HealthConnect: {
    checkAvailability: async () => ({ availability: 'Available' }),
    requestPermissions: async () => ({ read: ['ActivitySession'], write: [] }),
    getGrantedPermissions: async () => ({ read: ['ActivitySession'], write: [] }),
    aggregateRecords: async () => ({ aggregates: [] }),
    readRecords: async ({ start, end, type }: { start: string; end: string; type: string }) => {
      if (type !== 'ActivitySession') return { records: [] }
      if (hc.failRead) throw new Error('read failed')
      return {
        records: hc.sessions
          .filter(s => s.startTime >= start && s.startTime < end)
          .map(s => ({ startTime: s.startTime, endTime: s.endTime, exerciseType: s.exerciseType, metadata: { id: s.id, dataOrigin: s.origin } })),
      }
    },
  },
}))

import { syncHealthConnect, exerciseSweepWindow } from '../health-connect-sync'
import { OURA_APP_PACKAGE } from '@trainingai/shared/health/health-connect-origin'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const SAMSUNG = 'com.sec.android.app.shealth'
const today = () => todayInTz(TZ)
// Local midday, so a session never lands on a zone edge.
const midday = (day: string, plusMin = 0) => new Date(dateStrMidnightInTz(day, TZ).getTime() + (12 * 60 + plusMin) * 60_000).toISOString()

let posts: Array<Record<string, unknown>>
beforeEach(() => {
  cache.value = null
  hc.sessions = []
  hc.failRead = false
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    posts.push(init?.body ? JSON.parse(init.body as string) : {})
    return { ok: true, status: 200, json: async () => ({ enrichmentCandidates: [] }), text: async () => '' }
  }))
})

describe('syncHealthConnect exercise sessions (#3044)', () => {
  it('sends each session with its record id, and the whole local days it read', async () => {
    const day = shiftDateStr(today(), -2)
    hc.sessions = [{ id: 'hc-1', origin: SAMSUNG, startTime: midday(day), endTime: midday(day, 40), exerciseType: 'EXERCISE_TYPE_STRENGTH_TRAINING' }]
    await syncHealthConnect(TZ)
    const [daily] = posts
    expect(daily.exerciseSessions).toEqual([expect.objectContaining({
      recordId: 'hc-1', date: day, activityType: 'strength', startTime: '12:00', endTime: '12:40',
    })])
    expect(daily.exerciseSessions).toEqual([expect.not.objectContaining({ origin: expect.anything() })])
    // A cold sync reads 30 whole local days, ending today.
    expect(daily.exerciseWindow).toEqual({ from: shiftDateStr(today(), -29), to: today(), complete: true })
  })

  it('still posts the window when Health Connect has no sessions, so deletions reach the server', async () => {
    await syncHealthConnect(TZ)
    expect(posts[0]).toMatchObject({ exerciseSessions: [], exerciseWindow: { to: today(), complete: true } })
  })

  it('lists a session the Oura filter left out, so the server does not read it as deleted', async () => {
    cache.value = { date: today(), data: { connectedSources: { ring: false, strap: false, healthConnect: true, ouraCloud: true } } }
    const day = shiftDateStr(today(), -1)
    hc.sessions = [
      { id: 'oura-1', origin: OURA_APP_PACKAGE, startTime: midday(day), endTime: midday(day, 30), exerciseType: 'EXERCISE_TYPE_WALKING' },
      { id: 'hc-2', origin: SAMSUNG, startTime: midday(day, 60), endTime: midday(day, 90), exerciseType: 'EXERCISE_TYPE_WALKING' },
    ]
    await syncHealthConnect(TZ)
    expect((posts[0].exerciseSessions as { recordId: string }[]).map(s => s.recordId)).toEqual(['hc-2'])
    expect(posts[0].exerciseWindow).toMatchObject({ leftOut: ['oura-1'] })
  })

  it('marks the window incomplete when the read failed, so nothing is swept, and posts nothing for it alone', async () => {
    hc.failRead = true
    await syncHealthConnect(TZ)
    expect(posts).toEqual([])
  })
})

describe('exerciseSweepWindow', () => {
  const day = () => shiftDateStr(today(), -3)
  const midnight = (d: string) => dateStrMidnightInTz(d, TZ).toISOString()

  it('names the whole local days between two midnights', () => {
    expect(exerciseSweepWindow(midnight(day()), midnight(today()), TZ, { complete: true }))
      .toEqual({ from: day(), to: shiftDateStr(today(), -1), complete: true })
    expect(exerciseSweepWindow(midnight(day()), midnight(today()), TZ, { complete: false, leftOut: ['x'] }))
      .toEqual({ from: day(), to: shiftDateStr(today(), -1), complete: false, leftOut: ['x'] })
  })

  it('refuses a window that starts or ends inside a day', () => {
    expect(exerciseSweepWindow(midday(day()), midnight(today()), TZ, { complete: true })).toBeUndefined()
    expect(exerciseSweepWindow(midnight(day()), midday(today()), TZ, { complete: true })).toBeUndefined()
  })
})
