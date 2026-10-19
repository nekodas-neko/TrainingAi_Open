// #3079: a readiness read before Oura has delivered last night must not write a finished day.
//
// Under the Oura API last night lands only after the Oura app syncs, often mid-morning. Until then
// the newest night is yesterday's, and the payload used to persist its composite to YESTERDAY's row,
// built from today's activity, load and illness inputs, replacing the readiness that day had shown.
// Driven through the real `buildReadinessPayload`, because the defect was the persist's day key.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

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

/**
 * A fixed-offset zone whose local time is about 01:00 right now, so the just-after-midnight case
 * runs on every CI run rather than once a day (dates rule: Etc/GMT sign is inverted).
 */
function zoneNearLocalOneAm(): string {
  const off = ((1 - new Date().getUTCHours() + 36) % 24) - 12
  return off === 0 ? 'Etc/GMT' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`
}

const HOUR = 3_600_000

/**
 * `days` nights of Oura-API history ending on the morning `lastDaysAgo` days ago. Each night runs
 * 22:30 → 06:30 local, and its body-metrics row is that wake day's.
 */
function history(tz: string, days: number, lastDaysAgo: number) {
  const today = todayInTz(tz)
  const wakeDays = Array.from({ length: days }, (_, i) => shiftDateStr(today, -(lastDaysAgo + days - 1 - i)))
  const sleep = wakeDays.map((d, i) => {
    const mid = dateStrMidnightInTz(d, tz).getTime()
    return {
      id: `s${i}`, date: d, ouraId: `cloud-${d}`,
      sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
      durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
      efficiency: 90, avgHrv: 50 + (i % 3), restingHeartRate: 52 + (i % 2), respiratoryRate: 14.5,
      durationSource: 'oura_cloud', respiratoryRateSource: 'oura_cloud',
    }
  })
  const body = wakeDays.map((d, i) => ({
    date: d, hrvMs: 50 + (i % 3), restingHeartRate: 52 + (i % 2),
    hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud',
  }))
  return { today, sleep, body }
}

function readinessWrites() {
  return repo.upsertOuraDailyDerived.mock.calls
    .filter(([, , patch]) => patch.readinessScore !== undefined)
    .map(([, day, patch]) => ({ day, score: patch.readinessScore }))
}

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
})

describe.each([
  ['Australia/Brisbane'],
  [zoneNearLocalOneAm()],
])('readiness persist before and after Oura delivers last night (%s)', tz => {
  it('before the sync: serves a score but writes no readiness to any day', async () => {
    const { today, sleep, body } = history(tz, BASELINE_MIN_NIGHTS + 8, 1)
    repo.listSleepSessions.mockResolvedValue(sleep)
    repo.listBodyMetrics.mockResolvedValue(body)

    const out = await buildReadinessPayload('u1', tz)

    // The screen still has a number to show (built on the newest night it has)...
    expect(out.readinessDisplayScore).not.toBeNull()
    // ...but yesterday's stored readiness is the morning's, and today has no night to key one on.
    expect(readinessWrites()).toEqual([])
    // The sleep score still goes to its own night's day, which is yesterday's.
    const sleepDays = repo.upsertOuraDailyDerived.mock.calls.filter(([, , p]) => p.sleepScore !== undefined).map(([, day]) => day)
    expect(sleepDays).toEqual([shiftDateStr(today, -1)])
  })

  it("after the sync: writes today's row, and only today's", async () => {
    const { today, sleep, body } = history(tz, BASELINE_MIN_NIGHTS + 8, 0)
    repo.listSleepSessions.mockResolvedValue(sleep)
    repo.listBodyMetrics.mockResolvedValue(body)

    await buildReadinessPayload('u1', tz)

    const writes = readinessWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0].day).toBe(today)
    expect(writes[0].score).toEqual(expect.any(Number))
  })

  it('stamps the persisted sleep score with its model version beside readiness', async () => {
    const { today, sleep, body } = history(tz, BASELINE_MIN_NIGHTS + 8, 0)
    repo.listSleepSessions.mockResolvedValue(sleep)
    repo.listBodyMetrics.mockResolvedValue(body)

    await buildReadinessPayload('u1', tz)

    const todays = repo.upsertOuraDailyDerived.mock.calls.find(([, day]) => day === today)
    expect(todays?.[2].sleepScore).toEqual(expect.any(Number))
    expect(todays?.[2].modelVersions).toEqual({
      readiness: expect.any(String),
      sleep: expect.stringMatching(/^v\d+:/),
    })
  })
})
