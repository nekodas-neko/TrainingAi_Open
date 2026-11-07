/**
 * #3658 — Body Battery's "+charged / −drained" add up to the level it prints.
 *
 * The walk counts charge per sample before any cap. On a day with an exercise drain the level is
 * held at the morning mark (`levelWithExerciseDrain`), and on any day it is held at 100 and 0, so
 * charge spent against a cap never reached the level. The response now reports only what did,
 * so `anchor + charged − drained = current` on every day. The level and the stored gross totals
 * stay exactly as they were.
 *
 * Synthetic fixtures only; no production or owner data.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { computeBodyBatteryDay } from '../body-battery-day'
import { shownBatteryTotals } from '@trainingai/shared/health/body-battery-exercise'
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-25'
const MIN = 60_000
const dayMid = dateStrMidnightInTz(DATE, TZ).getTime()
const at = (h: number, m = 0) => new Date(dayMid + (h * 60 + m) * MIN)
const until = dateStrMidnightInTz(shiftDateStr(DATE, 1), TZ)

type Hr = { timestamp: Date; bpm: number; source: string | null }

/** A reading every `stepMin` minutes over [fromH, toH], at `bpm`. */
function series(stepMin: number, bpm: number, fromH = 7, toH = 22): Hr[] {
  const out: Hr[] = []
  for (let m = fromH * 60; m <= toH * 60; m += stepMin) out.push({ timestamp: at(0, m), bpm, source: 'any_source' })
  return out
}

interface Fixture {
  hr: Hr[]
  workouts?: { startedAt: Date; completedAt: Date; volume: number }[]
  steps?: number | null
  stepsGoal?: number
  anchor: number
}

function stubRepo(f: Fixture) {
  return {
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ date: DATE, restingHeartRate: 55, hrvMs: 55, steps: f.steps ?? null }],
    listSleepSessions: async () => [],
    getHrForWindow: async (_u: string, from: Date, to: Date) => f.hr.filter(r => r.timestamp >= from && r.timestamp < to),
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => null,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async () => [{
      date: DATE, anchor: f.anchor, anchorSource: 'readiness', endValue: 0, dayMin: 0, dayMax: 0,
      totalCharged: 0, totalDrained: 0, restingHr: 55, hrMax: 180, hrMaxObserved: null, hrSampleCount: 0, modelVersion: 'v7:x',
    }],
    getDaytimeHrvModel: async () => null,
    getWorkoutSessionsFrom: async () => (f.workouts ?? []).map((w, i) => ({
      id: `w${i}`, userId: 'u', sessionName: 'Session', startedAt: w.startedAt, completedAt: w.completedAt,
      exercises: [{ volume: w.volume }], isEarlyDeload: false, wasOverride: false,
    })),
    getUserGoals: async () => ({ stepsGoal: f.stepsGoal ?? 10_000 }),
    listActivityLogs: async () => [],
  } as unknown as WorkoutRepository
}

const run = (f: Fixture, end: Date = until) => computeBodyBatteryDay({
  repo: stubRepo(f), userId: 'u', tz: TZ, date: DATE, until: end, computeReadinessIfMissing: false,
})

// The issue's shape: anchor 60, two hours at rest on 5-minute samples (58 bpm, resting 55), half the step goal.
const issueDay: Fixture = { anchor: 60, hr: series(5, 58, 7, 9), steps: 5000 }

const DAYS: Record<string, { f: Fixture; end?: Date }> = {
  'a step drain on a resting morning (the issue)': { f: issueDay, end: at(9) },
  'a step drain over a whole charging day': { f: { anchor: 60, hr: series(5, 58), steps: 5000 } },
  'a workout drain': { f: { anchor: 70, hr: series(5, 58), workouts: [{ startedAt: at(17), completedAt: at(18), volume: 5200 }], steps: 0 } },
  'a day that ends at 0': { f: { anchor: 40, hr: series(5, 58), workouts: [{ startedAt: at(17), completedAt: at(18), volume: 9000 }], steps: 20_000 } },
  'a rest day held at 100': { f: { anchor: 95, hr: series(1, 58) } },
  'a rest day with no cap reached': { f: { anchor: 40, hr: series(1, 58, 7, 9) }, end: at(9) },
}

describe('Body Battery figures reconcile with the level (#3658)', () => {
  for (const [name, { f, end }] of Object.entries(DAYS)) {
    it(`start + charged − drained = level: ${name}`, async () => {
      const { response, snapshot } = await run(f, end)
      expect(response.hasData).toBe(true)
      expect(response.charged).toBeGreaterThanOrEqual(0)
      expect(response.drained).toBeGreaterThanOrEqual(0)
      expect(response.anchor + response.charged - response.drained).toBe(response.current)
      // The level is untouched: it is still the stored end value.
      expect(snapshot.endValue).toBe(response.current)
    })
  }

  it('the issue day: the level is 47 as before, and the walk\'s clipped charge is not shown as gained', async () => {
    const { response, snapshot } = await run(issueDay, at(9))
    expect(response.current).toBe(47)
    // Gross charge stays in the stored row (its write guard reads it as "this day moved").
    expect(snapshot.totalCharged).toBeGreaterThan(response.charged)
    expect(response).toMatchObject({ anchor: 60, charged: 0, drained: 13 })
  })

  it('a day with no cap reached shows the walk\'s own totals unchanged', async () => {
    const { response, snapshot } = await run(DAYS['a rest day with no cap reached'].f, at(9))
    expect(response.charged).toBe(snapshot.totalCharged)
    expect(response.drained).toBe(snapshot.totalDrained)
  })
})

describe('shownBatteryTotals', () => {
  it('drops charge that never reached the level, and drain lost at the floor', () => {
    expect(shownBatteryTotals(60, 47, 14.4, 13)).toEqual({ charged: 0, drained: 13 })
    expect(shownBatteryTotals(95, 100, 20, 0)).toEqual({ charged: 5, drained: 0 })
    expect(shownBatteryTotals(10, 0, 0, 30)).toEqual({ charged: 0, drained: 10 })
    expect(shownBatteryTotals(50, 55, 12, 7)).toEqual({ charged: 12, drained: 7 })
  })
  it('reconciles on the rounded figures the card prints', () => {
    const t = shownBatteryTotals(60.4, 47.6, 3.5, 16.3)
    expect(Math.round(60.4) + t.charged - t.drained).toBe(Math.round(47.6))
  })
})
