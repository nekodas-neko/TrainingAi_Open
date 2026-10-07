// #2336 / #2423 — what the readiness payload says when there is nothing to score recovery from, and
// which pillars it reports availability for.
//
// With no sleep, resting HR or HRV every recovery component is 0 and only load contributes, so the
// payload sent `score: 5, label: "Low"`. Its honest flags (`hasSufficientData: false`,
// `readinessDisplayScore: null`) were right, but consumers read the raw `score`: the rest-day card
// said "Rest fully — Readiness is low" and `availability` called readiness `present`, so the chip
// showed a dash with no reason. Driven through the real `buildReadinessPayload`, as the illness-radar
// test is, because the formula was never the defect: what the payload SENDS was.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import { restDayGuidance } from '@trainingai/shared/health/rest-day-guidance'

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
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
// From the clock, never a hardcoded date: the payload builds its own window from today.
const dayIso = (daysAgo: number) => shiftDateStr(todayInTz(TZ), -daysAgo)

/** Sixty days of weight and nothing else: body metrics exist, no recovery signal does. */
const weightOnly = (days: number) =>
  Array.from({ length: days }, (_, i) => ({ date: dayIso(days - 1 - i), weightKg: 80 }))

const withRecovery = (days: number) =>
  Array.from({ length: days }, (_, i) => ({ date: dayIso(days - 1 - i), restingHeartRate: 55, hrvMs: 70 }))

const availabilityOf = (out: Awaited<ReturnType<typeof buildReadinessPayload>>, metric: string) =>
  out.availability?.find(a => a.metric === metric)

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  repo.listBodyMetrics.mockResolvedValue([])
  repo.listSleepSessions.mockResolvedValue([])
  repo.getWorkoutSessionsFrom.mockResolvedValue([])
  repo.getOuraDaily.mockResolvedValue([])
  repo.getHrForWindow.mockResolvedValue([])
  repo.getOuraDailySummary.mockResolvedValue([])
  repo.getOuraDailyDerived.mockResolvedValue([])
})

describe('no recovery signal (#2336)', () => {
  it('sends no score at all, not a score of 5', async () => {
    repo.listBodyMetrics.mockResolvedValue(weightOnly(60))
    const out = await buildReadinessPayload('u1', TZ)

    expect(out.score).toBeNull()
    expect(out.readinessDisplayScore).toBeNull()
    expect(out.hasSufficientData).toBe(false)
  })

  it('reports readiness as absent, with the reason, so the chip can say why it is a dash', async () => {
    repo.listBodyMetrics.mockResolvedValue(weightOnly(60))
    const out = await buildReadinessPayload('u1', TZ)

    expect(availabilityOf(out, 'readiness')).toMatchObject({ state: 'absent', gap: 'no_input' })
  })

  it('keeps the load component in the breakdown', async () => {
    repo.listBodyMetrics.mockResolvedValue(weightOnly(60))
    const out = await buildReadinessPayload('u1', TZ)

    expect(out.components).toMatchObject({ sleep: 0, hrv: 0, rhr: 0 })
    expect(typeof out.components.load).toBe('number')
  })

  it('does not open the early-deload gate on the score it no longer sends', async () => {
    repo.listBodyMetrics.mockResolvedValue(weightOnly(60))
    const out = await buildReadinessPayload('u1', TZ)

    expect(out.earlyDeloadRecommended).toBe(false)
    expect(out.earlyDeload).toBeNull()
  })

  it('lets the rest-day card say it has no readiness data, instead of telling the user to rest', async () => {
    repo.listBodyMetrics.mockResolvedValue(weightOnly(60))
    const out = await buildReadinessPayload('u1', TZ)
    // What `components/rest-day-card.tsx` passes: `readiness?.score ?? null`.
    const g = restDayGuidance({ readinessScore: out.score ?? null, soreMuscles: [], sleepScore: out.sleepScore, consecutiveRestDays: null })

    expect(g.lowConfidence).toBe(true)
    expect(g.title).not.toBe('Rest fully')
  })
})

describe('a recovery signal present (#2336)', () => {
  it('still sends the score, equal to the display score, and reports readiness present', async () => {
    repo.listBodyMetrics.mockResolvedValue(withRecovery(BASELINE_MIN_NIGHTS + 6))
    const out = await buildReadinessPayload('u1', TZ)

    expect(typeof out.score).toBe('number')
    expect(out.score).toBe(out.readinessDisplayScore)
    expect(availabilityOf(out, 'readiness')).toMatchObject({ state: 'present', gap: null })
  })
})

describe('availability covers daytime stress and resilience (#2423)', () => {
  it('lists all five metrics, and leaves sleep and activity present/absent only', async () => {
    const out = await buildReadinessPayload('u1', TZ)

    expect(out.availability?.map(a => a.metric)).toEqual(['readiness', 'sleep', 'activity', 'daytimeStress', 'resilience'])
    expect(availabilityOf(out, 'sleep')?.degradedInputs).toEqual([])
    expect(availabilityOf(out, 'activity')?.degradedInputs).toEqual([])
  })

  it('reports both absent, as no_input, when nothing was derived', async () => {
    const out = await buildReadinessPayload('u1', TZ)

    expect(availabilityOf(out, 'daytimeStress')).toMatchObject({ state: 'absent', gap: 'no_input' })
    expect(availabilityOf(out, 'resilience')).toMatchObject({ state: 'absent', gap: 'no_input' })
  })

  it('counts today\'s stress minutes as present even at 0, which is a real reading', async () => {
    repo.getOuraDailyDerived.mockResolvedValue([{ day: dayIso(0), stressHighMinutes: 0 }])
    const out = await buildReadinessPayload('u1', TZ)

    expect(availabilityOf(out, 'daytimeStress')).toMatchObject({ state: 'present', gap: null })
  })

  it('reports resilience present when a recent day published a level, even if today has none', async () => {
    repo.getOuraDailyDerived.mockResolvedValue([
      { day: dayIso(3), resilienceLevel: 3.2, resilienceConfidence: 1 },
      { day: dayIso(0), resilienceLevel: null },
    ])
    const out = await buildReadinessPayload('u1', TZ)

    expect(availabilityOf(out, 'resilience')).toMatchObject({ state: 'present', gap: null })
  })
})
