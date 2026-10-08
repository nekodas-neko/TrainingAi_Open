// issue 2151 — characterization of `buildReadinessPayload` taken BEFORE the dead Oura-score branches
// were removed, and kept to prove the removal changed nothing.
//
// `oura_daily.readiness_score` is NULL on every row that can match today (the Cloud integration is
// gone; the last non-null value is the 2026-07-07 re-key date), so `ouraToday?.readinessScore != null`
// is false on every call. The five sites that read it (score/source choice, `readinessDisplayScore`,
// `hasSufficientData`, `ScoreAvailability`, and one disjunct of the early-deload gate) therefore only
// ever ran their fallback arm. Each scenario below goes through the real builder and pins the whole
// scored surface of the payload, including the early-deload gate with and without an HRV baseline.
// The inline snapshots were generated on `main` before the deletion and are unchanged by it.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateBaseline, type Baseline } from '@trainingai/shared/health/personal-baseline'

const TZ = 'Australia/Brisbane'

const repo = {
  listBodyMetrics: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  listSleepSessions: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async (_u: string, _f: Date) => [] as unknown[]),
  getOuraDaily: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getActiveProgram: vi.fn(async (_u: string) => null as unknown),
  listProgramPhases: vi.fn(async (_u: string, _p: string) => [] as unknown[]),
  countSessionsSinceStart: vi.fn(async (_u: string, _p: string) => 0),
  getHrForWindow: vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[]),
  getOuraDailySummary: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async (_u: string) => null),
  getMoodLog: vi.fn(async (_u: string, _d: string) => null),
  getUserById: vi.fn(async (_u: string) => ({ timezone: TZ, dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async (_u: string) => ({ stepsGoal: null })),
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const dayIso = (daysAgo: number) => shiftDateStr(todayInTz(TZ), -daysAgo)

const bodyHistory = (days: number, opts: { hrv?: boolean; rhr?: boolean } = {}) =>
  Array.from({ length: days }, (_, i) => ({
    date: dayIso(i),
    hrvMs: opts.hrv ? 55 + (i % 5) : undefined,
    restingHeartRate: opts.rhr ? 52 + (i % 4) : undefined,
    steps: 8000, activeCalories: 400, weightKg: 80,
  }))

const sleepHistory = (days: number, hours = 7.5) =>
  Array.from({ length: days }, (_, i) => {
    const d = dayIso(i)
    return {
      date: d,
      sleepStart: new Date(`${dayIso(i + 1)}T12:30:00.000Z`),
      sleepEnd: new Date(`${d}T20:00:00.000Z`),
      durationHours: hours, deepSleepHours: hours * 0.19, remSleepHours: hours * 0.21,
      lightSleepHours: hours * 0.56, awakHours: 0.3,
    }
  })

/** Sessions spread over 35 days, the last week heavy, so ACWR clears its gates and reads high. */
const sessions = () => {
  const mk = (back: number, volume: number) => ({
    id: `s${back}`, startedAt: new Date(`${dayIso(back)}T00:00:00.000Z`),
    exercises: [{ volume }],
  })
  return [
    ...[34, 30, 27, 23, 20, 16].map(b => mk(b, 2000)),
    ...[6, 5, 4, 3, 2, 1].map(b => mk(b, 9000)),
  ]
}

const program = (phaseMode: string) => ({
  id: 'p1', phaseMode, startedAt: null, createdAt: new Date(`${dayIso(120)}T00:00:00.000Z`),
  sessionsPerCycle: null,
})

const summary = (date: string) => {
  let rhr: Baseline | null = null, hrv: Baseline | null = null, sleep: Baseline | null = null
  for (let i = 0; i < 20; i++) {
    rhr = updateBaseline(rhr, 52, i); hrv = updateBaseline(hrv, 57, i); sleep = updateBaseline(sleep, 450, i)
  }
  return {
    date, nHistory: 20, sleepDurationHours: 7.5, sleepEfficiency: 92, rhrLowBpm: 51, hrvAvgMs: 60,
    tempMeanC: 36.4, breathAvgRpm: 14, tempDevC: 0.1, recoveryIndexHours: 6,
    rhrBaseline: rhr, hrvBaseline: hrv, sleepBaseline: sleep, tempBaseline: null, breathBaseline: null,
  }
}

/** The scored surface: everything the five sites feed, nothing clock-dependent. */
const pin = (out: Awaited<ReturnType<typeof buildReadinessPayload>>) => ({
  score: out.score,
  readinessDisplayScore: out.readinessDisplayScore,
  label: out.label,
  components: out.components,
  hasSufficientData: out.hasSufficientData,
  earlyDeloadRecommended: out.earlyDeloadRecommended,
  earlyDeload: out.earlyDeload,
  source: out.source,
  ouraScore: out.ouraScore,
  inputsAvailable: out.inputsAvailable,
  inputsMissing: out.inputsMissing,
  scoreConfidence: out.scoreConfidence,
  limited: out.limited,
  availability: out.availability,
})

const run = async () => pin(await buildReadinessPayload('u1', TZ))

// Expected outputs live beside the test, captured from `main` before the branches were deleted.
// Set CHARACTERIZE_DUMP=<path> to regenerate them (the repo's source-write guard forbids vitest's
// own inline-snapshot writer).
const EXPECTED_PATH = join(__dirname, 'readiness-payload-characterization-2151.expected.json')
const dump: Record<string, unknown> = {}
const check = async () => {
  const name = expect.getState().currentTestName ?? ''
  const actual = JSON.parse(JSON.stringify(await run()))
  if (process.env.CHARACTERIZE_DUMP) { dump[name] = actual; return }
  expect(actual).toEqual(JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'))[name])
}
afterAll(() => {
  if (process.env.CHARACTERIZE_DUMP) writeFileSync(process.env.CHARACTERIZE_DUMP, JSON.stringify(dump, null, 2) + '\n')
})

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  repo.listBodyMetrics.mockResolvedValue([])
  repo.listSleepSessions.mockResolvedValue([])
  repo.getWorkoutSessionsFrom.mockResolvedValue([])
  repo.getOuraDaily.mockResolvedValue([])
  repo.getActiveProgram.mockResolvedValue(null)
  repo.getHrForWindow.mockResolvedValue([])
  repo.getOuraDailySummary.mockResolvedValue([])
  repo.getOuraDailyDerived.mockResolvedValue([])
})

describe('buildReadinessPayload characterization (issue 2151)', () => {
  it('nothing at all', async () => {
    await check()
  })

  it('weight only: no recovery signal', async () => {
    repo.listBodyMetrics.mockResolvedValue(Array.from({ length: 60 }, (_, i) => ({ date: dayIso(i), weightKg: 80 })))
    await check()
  })

  it('sleep only', async () => {
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21))
    await check()
  })

  it('generic HRV and RHR with sleep', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21))
    await check()
  })

  it('RHR baseline only, no sleep: recovery signal without sleep', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { rhr: true }))
    await check()
  })

  it('ring rollup composite', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21))
    repo.getOuraDailySummary.mockResolvedValue([summary(dayIso(1)), summary(dayIso(0))])
    await check()
  })

  it('ring day with a Cloud row whose frozen readiness score is null', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21))
    repo.getOuraDaily.mockResolvedValue([{ date: dayIso(0), readinessScore: null, temperatureDeviation: 0.6, nonWearTimeSec: 3600 }])
    await check()
  })

  it('no HRV baseline, poor score, high load: the early-deload gate stays closed', async () => {
    repo.listBodyMetrics.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ date: dayIso(i), steps: 300, activeCalories: 10, weightKg: 80 })))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21, 1.5))
    repo.getWorkoutSessionsFrom.mockResolvedValue(sessions())
    repo.getActiveProgram.mockResolvedValue(program('ai_dynamic'))
    await check()
  })

  it('HRV baseline, poor sleep, high load: early deload fires (ai_dynamic)', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }).map((m, i) => (i < 7 ? { ...m, hrvMs: 10, restingHeartRate: 95, steps: 300, activeCalories: 10 } : { ...m, hrvMs: 70, restingHeartRate: 50 })))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21, 1.5))
    repo.getWorkoutSessionsFrom.mockResolvedValue(sessions())
    repo.getActiveProgram.mockResolvedValue(program('ai_dynamic'))
    await check()
  })

  it('HRV baseline and high load but a healthy score: gate open, no recommendation (automatic)', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21))
    repo.getWorkoutSessionsFrom.mockResolvedValue(sessions())
    repo.getActiveProgram.mockResolvedValue(program('automatic'))
    await check()
  })

  it('HRV baseline, poor sleep, high load, but manual mode: never recommended', async () => {
    repo.listBodyMetrics.mockResolvedValue(bodyHistory(21, { hrv: true, rhr: true }).map((m, i) => (i < 7 ? { ...m, hrvMs: 10, restingHeartRate: 95, steps: 300, activeCalories: 10 } : { ...m, hrvMs: 70, restingHeartRate: 50 })))
    repo.listSleepSessions.mockResolvedValue(sleepHistory(21, 1.5))
    repo.getWorkoutSessionsFrom.mockResolvedValue(sessions())
    repo.getActiveProgram.mockResolvedValue(program('manual'))
    await check()
  })
})
