// #3612 — the live day's Activity zone lane reads the one resting-HR rule keyed by (source, the
// source's algorithm version), over the 28 days of sleep the payload already reads. One version gives
// exactly what it gave before; a second version splits the mean at the change. Synthetic values and
// generic source names only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

const captured = vi.hoisted(() => ({ restingHr: new Map<string, number | null>() }))
let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@trainingai/shared/health/activity-day', async (orig) => {
  const real = await orig<typeof import('@trainingai/shared/health/activity-day')>()
  return {
    ...real,
    scoreActivityForDay: (i: Parameters<typeof real.scoreActivityForDay>[0]) => {
      captured.restingHr.set(i.date, i.restingHr ?? null)
      return real.scoreActivityForDay(i)
    },
  }
})

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-24'

/** 36 nights from `source_a`: 52 bpm up to 15 nights ago, 58 for the newest 15. */
const metrics = Array.from({ length: 36 }, (_, i) => {
  const back = 35 - i
  return {
    date: shiftDateStr(TODAY, -back), restingHeartRate: back >= 15 ? 52 : 58, restingHeartRateSource: 'source_a',
    hrvMs: 60, hrvSource: 'source_a', steps: 6000, activeCalories: 400,
  }
})
const night = (back: number, version: string | null) => ({
  date: shiftDateStr(TODAY, -back), durationSource: 'source_a', sourceAlgorithmVersion: version,
  sleepStart: new Date(`${shiftDateStr(TODAY, -back - 1)}T12:00:00Z`), sleepEnd: new Date(`${shiftDateStr(TODAY, -back)}T20:00:00Z`),
  durationHours: 8,
})
const NO_SLEEP: ReturnType<typeof night>[] = []
const ONE_VERSION = Array.from({ length: 29 }, (_, back) => night(back, '1.0'))
const TWO_VERSIONS = Array.from({ length: 29 }, (_, back) => night(back, back >= 15 ? '1.0' : '2.0'))

async function liveRestingHr(sleep: unknown[]) {
  const fx = monthFixture(TODAY, TZ)
  repo = {
    ...fixtureRepo(fx),
    listBodyMetrics: vi.fn(async (_u: string, from: string, to: string) => metrics.filter(m => m.date >= from && m.date <= to)),
    listSleepSessions: vi.fn(async (_u: string, from: string, to: string) =>
      (sleep as { date: string }[]).filter(s => s.date >= from && s.date <= to)),
  }
  captured.restingHr = new Map()
  const payload = await buildReadinessPayload('u1', TZ)
  // Today's is the live score; the finalise of an older day may run beside it, through the same rule.
  return { restingHr: captured.restingHr.get(TODAY), activity: payload.activitySignals, contributors: payload.activityContributors }
}

describe('the live Activity zone lane keys resting HR by algorithm version (#3612)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T05:00:00Z`))
  })
  afterEach(() => vi.useRealTimers())

  it('one version gives exactly what no version gave', async () => {
    const before = await liveRestingHr(NO_SLEEP)
    const after = await liveRestingHr(ONE_VERSION)
    expect(before.restingHr).toBe(55)
    expect(after).toEqual(before)
  })

  it('two versions split at the change', async () => {
    expect((await liveRestingHr(TWO_VERSIONS)).restingHr).toBe(58)
  })
})
