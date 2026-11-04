/**
 * #3495 — Body Battery drains with training and walking (v8), through `computeBodyBatteryDay`.
 *
 * - Where the day's heart rate is not per-minute, a finished workout and the steps drain against
 *   the user's goals; a rest day holds; everything hit ends near 0.
 * - Where a per-minute series covers the training, whatever sent it, the heart-rate walk keeps it,
 *   and a day with no exercise drain is the v7 walk exactly.
 * - The re-derive leaves stored days before the sign-off (17 Oct) as they are.
 *
 * Synthetic fixtures only; no production or owner data.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { computeBodyBatteryDay, BODY_BATTERY_MODEL_VERSION } from '../body-battery-day'
import { rederiveBodyBattery, BODY_BATTERY_RESCORE_SIGNED_OFF_FROM } from '../rederive-body-battery'
import type { BodyBatteryDailyRow, WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-25'
const MIN = 60_000
const dayMid = dateStrMidnightInTz(DATE, TZ).getTime()
const at = (h: number, m = 0) => new Date(dayMid + (h * 60 + m) * MIN)
const until = dateStrMidnightInTz(shiftDateStr(DATE, 1), TZ)

type Hr = { timestamp: Date; bpm: number; source: string | null }

/** A reading every `stepMin` minutes, 07:00–22:00, seated at 66 bpm (resting 58 + 8: the walk charges). */
function seated(stepMin: number, source: string): Hr[] {
  const out: Hr[] = []
  for (let m = 7 * 60; m <= 22 * 60; m += stepMin) out.push({ timestamp: at(0, m), bpm: 66, source })
  return out
}

interface Fixture {
  hr: Hr[]
  workouts?: { startedAt: Date; completedAt?: Date; volume: number }[]
  steps?: number | null
  stepsGoal?: number | null
  anchor?: number
}

function stubRepo(f: Fixture) {
  return {
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ date: DATE, restingHeartRate: 58, hrvMs: 55, steps: f.steps ?? null }],
    listSleepSessions: async () => [],
    getHrForWindow: async (_u: string, from: Date, to: Date) => f.hr.filter(r => r.timestamp >= from && r.timestamp < to),
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => null,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async () => [{
      date: DATE, anchor: f.anchor ?? 75, anchorSource: 'readiness', endValue: 0, dayMin: 0, dayMax: 0,
      totalCharged: 0, totalDrained: 0, restingHr: 58, hrMax: 180, hrMaxObserved: null, hrSampleCount: 0, modelVersion: 'v7:x',
    }],
    getDaytimeHrvModel: async () => null,
    getWorkoutSessionsFrom: async () => (f.workouts ?? []).map((w, i) => ({
      id: `w${i}`, userId: 'u', sessionName: 'Session', startedAt: w.startedAt, completedAt: w.completedAt,
      exercises: [{ volume: w.volume }], isEarlyDeload: false, wasOverride: false,
    })),
    getUserGoals: async () => ({ stepsGoal: f.stepsGoal ?? 8000 }),
    listActivityLogs: async () => [],
  } as unknown as WorkoutRepository
}

const run = (f: Fixture, end: Date = until) => computeBodyBatteryDay({
  repo: stubRepo(f), userId: 'u', tz: TZ, date: DATE, until: end, computeReadinessIfMissing: false,
})

// One full session at the default session-volume goal (5,200 kg), 17:00–18:00.
const session = { startedAt: at(17), completedAt: at(18), volume: 5200 }
// A sparse series: 5-minute points, as a source that sends no per-minute heart rate does.
const sparse = seated(5, 'any_source')

describe('the exercise drain in a day (#3495)', () => {
  it('stamps the current model (v8 drain, carried into v9)', () => {
    expect(BODY_BATTERY_MODEL_VERSION.startsWith('v9:rest+9bpm:')).toBe(true)
  })

  it('meets the pass tests: training ≥ 15 below rest, everything hit ≤ 5, a workout alone keeps reserve', async () => {
    const rest = await run({ hr: sparse, steps: 1500 })
    const workoutOnly = await run({ hr: sparse, workouts: [session], steps: 0 })
    const everything = await run({ hr: sparse, workouts: [session], steps: 8000 })

    expect(rest.response.anchor).toBe(75)
    expect(rest.response.current).toBeGreaterThanOrEqual(65)                       // holds near the morning
    expect(rest.response.current - workoutOnly.response.current).toBeGreaterThanOrEqual(15)
    expect(workoutOnly.response.current).toBeGreaterThanOrEqual(25)
    expect(everything.response.current).toBeLessThanOrEqual(5)

    expect(everything.response.exercise).toMatchObject({ workoutsCounted: 1, workoutsSeenByHr: 0, stepsCounted: true })
    // The drain is inside the stored totals and the curve, not beside them.
    expect(everything.snapshot.totalDrained).toBeGreaterThanOrEqual(everything.response.exercise!.drained)
    expect(everything.snapshot.endValue).toBe(everything.response.current)
    expect(everything.snapshot.dayMax).toBeLessThanOrEqual(75)
  })

  it('draws the workout as a drop across its own span', async () => {
    const { response } = await run({ hr: sparse, workouts: [session], steps: 0 })
    const before = response.series.filter(p => p.t <= at(17).getTime()).at(-1)!.v
    const after = response.series.find(p => p.t >= at(18).getTime())!.v
    expect(before - after).toBeGreaterThanOrEqual(30)
  })

  it('does not count a workout still in progress', async () => {
    const live = await run({ hr: sparse, workouts: [{ startedAt: at(17), volume: 5200 }], steps: 0 }, at(17, 30))
    expect(live.response.exercise!.workoutsCounted).toBe(0)
    expect(live.response.exercise!.drained).toBe(0)
  })

  it('leaves a workout a per-minute series covers to the heart-rate walk, whatever the source', async () => {
    const strap: Hr[] = []
    for (let s = 0; s <= 3600; s += 5) strap.push({ timestamp: new Date(at(17).getTime() + s * 1000), bpm: 130, source: 'any_strap' })
    const { response } = await run({ hr: [...sparse, ...strap].sort((a, b) => +a.timestamp - +b.timestamp), workouts: [session], steps: 0 })
    expect(response.exercise).toMatchObject({ workoutsCounted: 0, workoutsSeenByHr: 1, drained: 0 })
  })

  it('is the v7 walk exactly where a per-minute series covers the whole day', async () => {
    const perMinute = seated(1, 'any_watch')
    const plain = await run({ hr: perMinute })
    const walked = await run({ hr: perMinute, steps: 12_000 })
    expect(walked.response.exercise).toMatchObject({ stepsCounted: false, drained: 0 })
    expect(walked.response.current).toBe(plain.response.current)
    expect(walked.snapshot.totalDrained).toBe(plain.snapshot.totalDrained)
    // With no exercise drain the walk's charge above the morning mark stands, as in v7.
    expect(plain.snapshot.dayMax).toBeGreaterThan(75)
  })

  it('falls back to the walk alone when the exercise inputs cannot be read', async () => {
    const repo = stubRepo({ hr: sparse, steps: 8000 }) as unknown as Record<string, unknown>
    repo.getUserGoals = async () => { throw new Error('down') }
    repo.getWorkoutSessionsFrom = async () => { throw new Error('down') }
    const { response } = await computeBodyBatteryDay({
      repo: repo as unknown as WorkoutRepository, userId: 'u', tz: TZ, date: DATE, until, computeReadinessIfMissing: false,
    })
    // The steps still drain against the default goal; the failed reads cost only their own input.
    expect(response.exercise!.workoutsCounted).toBe(0)
    expect(response.exercise!.stepsCounted).toBe(true)
  })
})

describe('the re-derive keeps days before the sign-off (#3495)', () => {
  it('leaves a stored day before 17 Oct as it is and re-scores one from it', async () => {
    expect(BODY_BATTERY_RESCORE_SIGNED_OFF_FROM).toBe('2026-10-17')
    const days = ['2026-10-16', '2026-10-17']
    const stored = new Map<string, BodyBatteryDailyRow>(days.map(d => [d, {
      date: d, anchor: 75, anchorSource: 'readiness', endValue: 70, dayMin: 60, dayMax: 80,
      totalCharged: 4, totalDrained: 3, restingHr: 58, hrMax: 180, hrMaxObserved: null, hrSampleCount: 100, modelVersion: 'v7:stored',
    }]))
    const writes: string[] = []
    const hrAll = days.flatMap(d => {
      const mid = dateStrMidnightInTz(d, TZ).getTime()
      return Array.from({ length: 180 }, (_, i) => ({ timestamp: new Date(mid + (7 * 60 + i * 5) * MIN), bpm: 66, source: 'any_source' }))
    })
    const repo = {
      ...(stubRepo({ hr: hrAll, steps: 8000 }) as unknown as Record<string, unknown>),
      listBodyMetrics: async (_u: string, _f: string, to: string) => [{ date: to, restingHeartRate: 58, hrvMs: 55, steps: 8000 }],
      getBodyBatteryHistory: async (_u: string, from: string, to: string) => [...stored.values()].filter(r => r.date >= from && r.date <= to),
      upsertBodyBatteryDaily: async (_u: string, row: BodyBatteryDailyRow) => { writes.push(row.date); stored.set(row.date, row); return true },
    } as unknown as WorkoutRepository

    const result = await rederiveBodyBattery({ repo, userId: 'u', tz: TZ, from: days[0], to: days[1], dryRun: false })
    if (!result.ok) throw new Error(result.error)
    const byDate = Object.fromEntries(result.report.days.map(d => [d.date, d]))
    expect(byDate['2026-10-16'].action).toBe('before-sign-off')
    expect(byDate['2026-10-16'].recomputed).toBeUndefined()
    expect(byDate['2026-10-17'].action).toBe('written')
    expect(result.report.summary.beforeSignOff).toBe(1)
    expect(writes).toEqual(['2026-10-17'])
    expect(stored.get('2026-10-16')!.modelVersion).toBe('v7:stored')
    expect(stored.get('2026-10-17')!.modelVersion.startsWith('v9:')).toBe(true)
  })
})
