/**
 * #3601 — Body Battery's resting-HR mean and daytime-HRV baseline are keyed by (source, algorithm
 * version), the version read from the same night's sleep (v9). One version: the v8 numbers exactly.
 * Two: the earlier version's nights leave the normal once the new one has its 14 nights.
 * Synthetic fixtures with a generic source name; no production or owner data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

// A pass-through that records the readings the daytime-HRV baseline is learned from.
const normals = vi.hoisted(() => ({ calls: [] as { readings: { value: number | null | undefined; algorithmVersion?: string | null }[]; used: number | null }[] }))
vi.mock('@trainingai/shared/health/per-device-normal', async importOriginal => {
  const real = await importOriginal<typeof import('@trainingai/shared/health/per-device-normal')>()
  return {
    ...real,
    perDeviceNormal: (readings: Parameters<typeof real.perDeviceNormal>[0], opts: Parameters<typeof real.perDeviceNormal>[1]) => {
      const result = real.perDeviceNormal(readings, opts)
      // What Body Battery reads: the normal, or the previous version's while the new one warms.
      normals.calls.push({ readings: [...readings], used: real.normalOrCarriedOver(result) })
      return result
    },
  }
})

import { computeBodyBatteryDay, BODY_BATTERY_MODEL_VERSION } from '../body-battery-day'
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-25'
const SRC = 'source_a'
const until = dateStrMidnightInTz(shiftDateStr(DATE, 1), TZ)
const day = (back: number) => shiftDateStr(DATE, -back)

/** 28 nights, newest first: the newest `newNights` read 60 bpm / 70 ms, the rest 50 bpm / 40 ms. */
const metrics = (newNights: number) => Array.from({ length: 28 }, (_, i) => ({
  date: day(i), restingHeartRate: i < newNights ? 60 : 50, hrvMs: i < newNights ? 70 : 40,
  restingHeartRateSource: SRC, hrvSource: SRC,
}))
const sleep = (newNights: number, newVersion: string, oldVersion: string) => Array.from({ length: 28 }, (_, i) => ({
  date: day(i), durationSource: SRC, sourceAlgorithmVersion: i < newNights ? newVersion : oldVersion,
}))

function stubRepo(bodyMetrics: unknown[], sleepSessions: unknown[]) {
  return {
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => bodyMetrics,
    listSleepSessions: async () => sleepSessions,
    getHrForWindow: async () => [],
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => null,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async () => [{
      date: DATE, anchor: 75, anchorSource: 'readiness', endValue: 0, dayMin: 0, dayMax: 0,
      totalCharged: 0, totalDrained: 0, restingHr: 58, hrMax: 180, hrMaxObserved: null, hrSampleCount: 0, modelVersion: 'v8:x',
    }],
    getDaytimeHrvModel: async () => null,
    getWorkoutSessionsFrom: async () => [],
    getUserGoals: async () => ({ stepsGoal: 8000 }),
    listActivityLogs: async () => [],
  } as unknown as WorkoutRepository
}

async function run(bodyMetrics: unknown[], sleepSessions: unknown[]) {
  normals.calls.length = 0
  const out = await computeBodyBatteryDay({ repo: stubRepo(bodyMetrics, sleepSessions), userId: 'u', tz: TZ, date: DATE, until, computeReadinessIfMissing: false })
  // The daytime-HRV call is the one whose readings carry the HRV values.
  const hrv = normals.calls.find(c => c.readings.some(r => r.value === 40 || r.value === 70))
  return { restingHr: out.snapshot.restingHr, dhrvBaseline: hrv?.used ?? null }
}

beforeEach(() => { normals.calls.length = 0 })

describe('Body Battery normals keyed by algorithm version (#3601)', () => {
  it('stamps v9', () => {
    expect(BODY_BATTERY_MODEL_VERSION.startsWith('v9:rest+9bpm:')).toBe(true)
    expect(BODY_BATTERY_MODEL_VERSION.endsWith(':algv')).toBe(true)
  })

  it('one version: the resting HR and daytime-HRV baseline are those with no version stored', async () => {
    const before = await run(metrics(14), [])
    const after = await run(metrics(14), sleep(14, '1', '1'))
    expect(after).toEqual(before)
    expect(after.restingHr).toBe(55)          // pooled over both stretches
  })

  it('two versions: both normals are the new version’s own once it has 14 nights', async () => {
    const out = await run(metrics(14), sleep(14, '2', '1'))
    expect(out.restingHr).toBe(60)
    expect(out.dhrvBaseline).toBe(70)
  })

  it('two versions, the new one warming: the previous version’s normal holds', async () => {
    const out = await run(metrics(6), sleep(6, '2', '1'))
    expect(out.restingHr).toBe(50)
    expect(out.dhrvBaseline).toBe(40)
  })
})
