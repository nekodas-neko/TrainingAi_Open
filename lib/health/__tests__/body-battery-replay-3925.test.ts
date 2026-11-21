/**
 * #3925 item 2 — the replay harness runs the app's own Body Battery day, not a copy of it.
 *
 * The proof the issue asks for: for a fixture day that exercises v8's exercise drain, v9's
 * version-keyed resting-HR normal and a readiness anchor on the 75-centred scale, the harness's
 * replay gives exactly the row the app's own re-derive writes. And the count the owner signs off
 * on (#3925 item 1) is counts and bands, with no health value in it.
 *
 * Synthetic fixtures only; no production or owner data.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { BODY_BATTERY_MODEL_VERSION } from '../body-battery-day'
import { rederiveBodyBattery } from '../rederive-body-battery'
import {
  captureFinishedDays,
  endValueChangeBands,
  endValueChangeBandsFromReport,
  parseRecording,
  recordingRepository,
  replayFinishedDays,
  replayRepository,
  serialiseRecording,
} from '../body-battery-replay'
import type { BodyBatteryDailyRow, WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = '2026-11-19'
const MIN = 60_000
const dayMid = dateStrMidnightInTz(DATE, TZ).getTime()
const at = (h: number, m = 0) => new Date(dayMid + (h * 60 + m) * MIN)
const V18 = 'v18:baseline-centre-75:2026-11-15'

type Hr = { timestamp: Date; bpm: number; source: string | null }

/** A sparse day: a reading every 5 minutes, seated, with a climb in the afternoon. */
function heartRate(): Hr[] {
  const out: Hr[] = []
  for (let m = 6 * 60 + 30; m <= 22 * 60; m += 5) {
    const bpm = m >= 15 * 60 && m < 16 * 60 ? 112 : 64 + (m % 3)
    out.push({ timestamp: at(0, m), bpm, source: 'any_source' })
  }
  return out
}

/** Fourteen nights from each of two devices: v9 keys the resting-HR normal by device and version. */
function bodyMetrics() {
  return Array.from({ length: 28 }, (_, i) => {
    const date = shiftDateStr(DATE, -27 + i)
    const newer = i >= 14
    return {
      date,
      restingHeartRate: newer ? 56 : 61,
      restingHeartRateSource: newer ? 'device_b' : 'device_a',
      hrvMs: newer ? 58 : 44,
      hrvSource: newer ? 'device_b' : 'device_a',
      steps: date === DATE ? 9400 : 6000,
    }
  })
}

const stored: BodyBatteryDailyRow = {
  // A morning snapshot: written at 09:00 on the sleep anchor, before readiness was stored.
  date: DATE, anchor: 70, anchorSource: 'sleep', endValue: 71, dayMin: 68, dayMax: 72,
  totalCharged: 3, totalDrained: 2, restingHr: 56, hrMax: 180, hrMaxObserved: 96, hrSampleCount: 30,
  modelVersion: BODY_BATTERY_MODEL_VERSION,
}

function fixtureRepo(upsert = vi.fn(async (_u: string, _r: BodyBatteryDailyRow) => true)) {
  const hr = heartRate()
  const repo = {
    getOuraDaily: async () => [],
    // Readiness on the 75-centred scale is the day's anchor (18 Nov).
    getOuraDailyDerived: async () => [{ day: DATE, readinessScore: 82, modelVersions: { readiness: V18 } }],
    listBodyMetrics: async () => bodyMetrics(),
    listSleepSessions: async () => [],
    getHrForWindow: async (_u: string, from: Date, to: Date) => hr.filter(r => r.timestamp >= from && r.timestamp < to),
    getUserById: async () => ({ id: 'u', email: 'not-kept@example.invalid', dateOfBirth: '1990-01-01', activityLevel: 'moderate' }),
    getOuraCloudSwitchDay: async () => null,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async (_u: string, from: string, to: string) => (stored.date >= from && stored.date <= to ? [{ ...stored }] : []),
    getDaytimeHrvModel: async () => null,
    getWorkoutSessionsFrom: async () => [{
      id: 'w1', userId: 'u', sessionName: 'Session', startedAt: at(17), completedAt: at(18),
      exercises: [{ volume: 4800 }], isEarlyDeload: false, wasOverride: false,
    }],
    getUserGoals: async () => ({ stepsGoal: 8000 }),
    listActivityLogs: async () => [],
    upsertBodyBatteryDaily: upsert,
  }
  return { repo: repo as unknown as WorkoutRepository, upsert }
}

describe('#3925: the harness replays exactly what the app stores', () => {
  it('a recorded day replays to the row the re-derive writes, field for field', async () => {
    // What the app's own code stores for the finished day.
    const { repo, upsert } = fixtureRepo()
    const result = await rederiveBodyBattery({ repo, userId: 'u', tz: TZ, from: DATE, to: DATE, dryRun: false })
    expect(result.ok).toBe(true)
    expect(upsert).toHaveBeenCalledTimes(1)
    const written = upsert.mock.calls[0][1]

    // The harness: record the inputs, write them out and read them back, then replay.
    const { recording, dates } = await captureFinishedDays(fixtureRepo().repo, 'u', TZ, DATE, DATE)
    const [day] = await replayFinishedDays(parseRecording(serialiseRecording(recording)), dates)

    expect(day.error).toBeUndefined()
    expect(day.recomputed).toEqual(written)
    expect(day.stored?.endValue).toBe(stored.endValue)
    // The fixture reaches every part the old harness lacked.
    expect(written.modelVersion).toBe(BODY_BATTERY_MODEL_VERSION)
    expect(written.anchor).toBe(82)                // readiness anchor, 75-centred
    expect(written.anchorSource).toBe('readiness')
    expect(written.restingHr).toBe(56)             // the device in use, not the pooled mean (v9)
    expect(written.totalDrained).toBeGreaterThan(20) // the workout and the steps drained (v8)
  })

  it('records nothing it does not need: the user row keeps only the two fields a day reads', async () => {
    const { recording } = await captureFinishedDays(fixtureRepo().repo, 'u', TZ, DATE, DATE)
    const user = recording.calls.find(c => c.key.startsWith('getUserById('))!.result
    expect(user).toEqual({ dateOfBirth: '1990-01-01', activityLevel: 'moderate' })
  })

  it('cannot write: the recorder and the replay refuse every method that is not a battery read', async () => {
    const { repo, upsert } = fixtureRepo()
    const rec = recordingRepository(repo, 'u', TZ)
    expect(() => (rec.repo as unknown as { upsertBodyBatteryDaily: () => unknown }).upsertBodyBatteryDaily()).toThrow(/not a Body Battery read/)
    expect(upsert).not.toHaveBeenCalled()
    const replay = replayRepository({ userId: 'u', tz: TZ, calls: [] })
    expect(() => (replay as unknown as { upsertBodyBatteryDaily: () => unknown }).upsertBodyBatteryDaily()).toThrow(/not a Body Battery read/)
  })

  it('fails loudly on a read it never recorded, instead of replaying a different day', async () => {
    const { recording } = await captureFinishedDays(fixtureRepo().repo, 'u', TZ, DATE, DATE)
    const [day] = await replayFinishedDays(recording, [shiftDateStr(DATE, -1)])
    expect(day.recomputed).toBeNull()
    expect(day.error).toMatch(/no recorded answer/)
  })
})

describe('#3925 item 1: the count of days that move, in bands', () => {
  it('counts moved days by band and direction, and days a recompute would add', () => {
    const count = endValueChangeBands([
      { stored: 50, recomputed: 50 },
      { stored: 50, recomputed: 52 },
      { stored: 50, recomputed: 46 },
      { stored: 50, recomputed: 40 },
      { stored: 50, recomputed: 35 },
      { stored: 50, recomputed: 10 },
      { stored: null, recomputed: 30 },
      { stored: 40, recomputed: null },
    ])
    expect(count).toEqual({
      daysExamined: 8, unchanged: 1, changed: 5, up: 1, down: 4,
      bands: { '1-2': 1, '3-5': 1, '6-10': 1, '11-20': 1, '21+': 1 },
      wouldAdd: 1, notRecomputed: 1,
    })
  })

  it('reads the production dry-run report the same way, and holds no health value', () => {
    const count = endValueChangeBandsFromReport({ days: [
      { action: 'written', stored: { endValue: 70 }, recomputed: { endValue: 31 } },
      { action: 'unchanged', stored: { endValue: 20 }, recomputed: { endValue: 20 } },
      { action: 'kept', stored: { endValue: 44 }, recomputed: { endValue: 60 } },
      { action: 'no-row' },
      { action: 'no-row', error: 'boom' },
      { action: 'before-sign-off', stored: { endValue: 55 } },
      { action: 'today' },
    ] })
    expect(count).toMatchObject({
      daysExamined: 7, changed: 1, unchanged: 2, noRow: 1, beforeSignOff: 1, keptByWriteGuard: 1, notRecomputed: 1,
      bands: { '21+': 1 },
    })
    // Every value in the count is a whole count of days.
    const values = [...Object.values(count).filter(v => typeof v === 'number'), ...Object.values(count.bands)] as number[]
    expect(values.every(v => Number.isInteger(v) && v >= 0 && v <= 7)).toBe(true)
  })
})
