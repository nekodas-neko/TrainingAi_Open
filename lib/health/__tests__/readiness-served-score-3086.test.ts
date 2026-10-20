// #3086: the stored readiness is the one the screen serves, after the illness radar's suppression.
//
// On 19 Oct's `pnpm dev` morning the radar read `elevated`: the route served a readiness 10 points
// below the composite and the persist stored the composite, so every reader of the stored value saw
// a readiness higher than the one shown. Driven through the real `buildReadinessPayload`; only the
// radar's verdict is fixed, so the suppressed and the clear case run on identical inputs.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import { READINESS_SUPPRESSION, type IllnessFlag } from '@trainingai/shared/health/illness-radar'

const radar = { flag: 'normal' as IllnessFlag }
vi.mock('@trainingai/shared/health/illness-radar', async orig => {
  const real = await orig<typeof import('@trainingai/shared/health/illness-radar')>()
  return {
    ...real,
    computeIllnessRadar: () => ({
      flag: radar.flag, score: radar.flag === 'normal' ? 12 : 70, biomarkers: { rhr: { z: 2.1, weight: 0.4 } },
      readinessSuppression: real.READINESS_SUPPRESSION[radar.flag],
    }),
  }
})

const repo = {
  listBodyMetrics: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  listSleepSessions: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async (_u: string, _f: Date) => [] as unknown[]),
  getOuraDaily: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getActiveProgram: vi.fn(async (_u: string) => null),
  getHrForWindow: vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[]),
  getOuraDailySummary: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async (_u: string) => null),
  getMoodLog: vi.fn(async (_u: string, _d: string) => null),
  getUserById: vi.fn(async (_u: string) => ({ timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async (_u: string) => ({ stepsGoal: null })),
  upsertOuraDailyDerived: vi.fn(async (_u: string, _d: string, _p: Record<string, unknown>) => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

/** Oura-API nights through this morning, enough for mature normals. */
function history() {
  const today = todayInTz(TZ)
  const days = BASELINE_MIN_NIGHTS + 8
  const wakeDays = Array.from({ length: days }, (_, i) => shiftDateStr(today, -(days - 1 - i)))
  const sleep = wakeDays.map((d, i) => {
    const mid = dateStrMidnightInTz(d, TZ).getTime()
    return {
      id: `s${i}`, date: d, ouraId: `cloud-${d}`,
      sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
      durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
      efficiency: 90, avgHrv: 50 + (i % 3), restingHeartRate: 52 + (i % 2), respiratoryRate: 14.5,
      durationSource: 'oura_cloud', respiratoryRateSource: 'oura_cloud',
    }
  })
  const body = wakeDays.map((d, i) => ({
    date: d, hrvMs: 50 + (i % 3), restingHeartRate: 52 + (i % 2), hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud',
  }))
  return { today, sleep, body }
}

async function readOnce(flag: IllnessFlag) {
  radar.flag = flag
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  const { today, sleep, body } = history()
  repo.listSleepSessions.mockResolvedValue(sleep)
  repo.listBodyMetrics.mockResolvedValue(body)
  const out = await buildReadinessPayload('u1', TZ)
  const stored = repo.upsertOuraDailyDerived.mock.calls.find(([, day, p]) => day === today && p.readinessScore !== undefined)?.[2]
  return { out, stored }
}

beforeEach(() => { radar.flag = 'normal' })

describe('stored readiness is the served readiness (#3086)', () => {
  it.each([['elevated'], ['fever']] as const)('on a %s day: stores the suppressed score the screen shows, with the flag beside it', async flag => {
    const clear = await readOnce('normal')
    const sick = await readOnce(flag)

    // Same inputs, so the composite is the same; the served score is that less the suppression.
    expect(sick.out.readinessDisplayScore).toBe(Math.max(0, clear.out.readinessDisplayScore! - READINESS_SUPPRESSION[flag]))
    expect(sick.out.illnessSuppression).toBe(READINESS_SUPPRESSION[flag])
    // What is stored is what was served, not the composite before the radar.
    expect(sick.stored?.readinessScore).toBe(sick.out.readinessDisplayScore)
    expect(sick.stored?.readinessScore).not.toBe(clear.stored?.readinessScore)
    // The contributors stay the composite's own, so the day stays explainable: stored + suppression.
    expect(sick.stored?.readinessContributors).toEqual(clear.stored?.readinessContributors)
    expect(sick.stored).toMatchObject({ illnessFlag: flag, illnessScore: 70, illnessBiomarkers: { rhr: { z: 2.1, weight: 0.4 } } })
  })

  it('on a clear day: stores the composite, unchanged, and the radar it ran', async () => {
    const { out, stored } = await readOnce('normal')
    expect(stored?.readinessScore).toBe(out.readinessDisplayScore)
    expect(stored).toMatchObject({ illnessFlag: 'normal', illnessScore: 12 })
  })
})
