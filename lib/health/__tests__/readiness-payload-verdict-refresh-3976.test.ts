// #3976: the call in `buildReadinessPayload` that makes an unanswered verdict follow today's readiness,
// and the condition that keeps it off every read that changes nothing.
//
// Driven through the real `buildReadinessPayload` over a stateful in-memory repository: derived rows
// are stored as JSONB would hold them (round-tripped, object keys reordered), and the verdict store
// honours `response_state = 'none'` the way the adapter's UPDATE does. Fixtures anchor to local midday.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS, READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import type { ReadinessVerdictRecord } from '@trainingai/shared/types'

const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

type DerivedRow = Record<string, unknown> & { day: string }

/** What a JSONB column hands back: a JSON round trip with object keys in another order. */
function asJsonb(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(asJsonb)
  const obj = JSON.parse(JSON.stringify(v)) as Record<string, unknown>
  return Object.fromEntries(Object.keys(obj).sort().reverse().map(k => [k, asJsonb(obj[k])]))
}

const derived = new Map<string, DerivedRow>()
const verdicts = new Map<string, ReadinessVerdictRecord>()

const repo = {
  listBodyMetrics: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  listSleepSessions: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async (_u: string, _f: Date) => [] as unknown[]),
  getOuraDaily: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getActiveProgram: vi.fn(async (_u: string) => null),
  getHrForWindow: vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[]),
  getOuraDailySummary: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
    [...derived.values()].filter(r => r.day >= from && r.day <= to).sort((a, b) => (a.day < b.day ? -1 : 1)).map(r => structuredClone(r))),
  getLatestOuraCloudVitals: vi.fn(async (_u: string) => null),
  getMoodLog: vi.fn(async (_u: string, _d: string) => null),
  getUserById: vi.fn(async (_u: string) => ({ timezone: TZ, dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async (_u: string) => ({ stepsGoal: null })),
  upsertOuraDailyDerived: vi.fn(async (_u: string, day: string, patch: Record<string, unknown>) => {
    const prior = derived.get(day) ?? { day }
    const next: DerivedRow = { ...prior }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      next[k] = k === 'modelVersions'
        ? asJsonb({ ...(prior.modelVersions as Record<string, unknown> | undefined), ...(v as Record<string, unknown>) })
        : asJsonb(v)
    }
    derived.set(day, next)
  }),
  upsertOuraDailySummary: vi.fn(async () => undefined),
  getReadinessVerdict: vi.fn(async (_u: string, d: string) => {
    const v = verdicts.get(d)
    return v ? structuredClone(v) : null
  }),
  refreshUnansweredReadinessVerdict: vi.fn(async (_u: string, rec: Omit<ReadinessVerdictRecord, 'responseState'>) => {
    const v = verdicts.get(rec.date)
    if (!v || v.responseState !== 'none') return false
    verdicts.set(rec.date, { ...structuredClone(rec), responseState: 'none' })
    return true
  }),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

// Pinned to V1, as the other payload tests do: these nights are dated relative to today.
vi.mock('@trainingai/shared/health/sleep-score', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trainingai/shared/health/sleep-score')>()
  return {
    ...actual,
    SLEEP_SCORE_V2_FROM: null,
    computeSleepScore: ((session, tz, opts) =>
      actual.computeSleepScore(session, tz, { v2From: null, ...opts })) as typeof actual.computeSleepScore,
  }
})

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { buildReadinessVerdictRecord } from '@/lib/health/readiness-verdict-refresh'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

let today: string

/** Oura-API nights ending this morning, plus 28 stored readiness days on today's model for the band. */
function seed() {
  today = todayInTz(TZ)
  const days = BASELINE_MIN_NIGHTS + 8
  const wakeDays = Array.from({ length: days }, (_, i) => shiftDateStr(today, -(days - 1 - i)))
  repo.listSleepSessions.mockResolvedValue(wakeDays.map((d, i) => {
    const mid = dateStrMidnightInTz(d, TZ).getTime()
    return {
      id: `s${i}`, date: d, ouraId: `cloud-${d}`,
      sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
      durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
      efficiency: 90, avgHrv: 50 + (i % 3), restingHeartRate: 52 + (i % 2), respiratoryRate: 14.5,
      durationSource: 'oura_cloud', respiratoryRateSource: 'oura_cloud',
    }
  }))
  repo.listBodyMetrics.mockResolvedValue(wakeDays.map((d, i) => ({
    date: d, hrvMs: 50 + (i % 3), restingHeartRate: 52 + (i % 2),
    hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud',
  })))
  for (let i = 28; i >= 1; i--) {
    const s = 60 + ((i - 1) % 7)
    derived.set(shiftDateStr(today, -i), {
      day: shiftDateStr(today, -i), readinessScore: s,
      readinessContributors: { hrvBalance: { score: s } }, modelVersions: { readiness: READINESS_MODEL_VERSION },
    })
  }
}

/** The verdict the first read would freeze from what is stored for today right now. */
function freezeVerdict(state: ReadinessVerdictRecord['responseState']) {
  const built = buildReadinessVerdictRecord(today, [...derived.values()] as never)
  if (built.kind !== 'record') throw new Error(`fixture: ${built.kind}`)
  verdicts.set(today, { ...built.record, responseState: state })
}

/** Today's stored row as an earlier read left it: the same contributors, a different score. */
function storeEarlierScore(delta: number) {
  const row = derived.get(today)!
  derived.set(today, { ...row, readinessScore: Math.max(0, Math.min(100, (row.readinessScore as number) + delta)) })
}

beforeEach(() => {
  derived.clear()
  verdicts.clear()
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  seed()
})

describe('#3976 buildReadinessPayload keeps an unanswered verdict on today’s readiness', () => {
  it('a persist that changes today’s score moves the frozen unanswered row to it', async () => {
    await buildReadinessPayload('u1', TZ)
    const served = derived.get(today)!.readinessScore as number
    expect(served).toEqual(expect.any(Number))
    // An earlier read stored a different score, and the verdict froze on it.
    const delta = served >= 50 ? -25 : 25
    storeEarlierScore(delta)
    freezeVerdict('none')
    expect(verdicts.get(today)!.score).toBe(served + delta)

    await buildReadinessPayload('u1', TZ)

    expect(derived.get(today)!.readinessScore).toBe(served)
    expect(repo.refreshUnansweredReadinessVerdict).toHaveBeenCalledTimes(1)
    expect(verdicts.get(today)!.score).toBe(served)
    expect(verdicts.get(today)!.responseState).toBe('none')
  })

  it('a persist that changes nothing reads no verdict at all', async () => {
    await buildReadinessPayload('u1', TZ)
    freezeVerdict('none')
    const before = structuredClone(verdicts.get(today))
    repo.getReadinessVerdict.mockClear()
    repo.refreshUnansweredReadinessVerdict.mockClear()
    repo.upsertOuraDailyDerived.mockClear()

    await buildReadinessPayload('u1', TZ)

    // Today's readiness was re-persisted (same score, model and contributors as stored)...
    expect(repo.upsertOuraDailyDerived.mock.calls.some(([, day, p]) => day === today && p.readinessScore !== undefined)).toBe(true)
    // ...and the refresh did not run: no SELECT, no UPDATE.
    expect(repo.getReadinessVerdict).not.toHaveBeenCalled()
    expect(repo.refreshUnansweredReadinessVerdict).not.toHaveBeenCalled()
    expect(verdicts.get(today)).toEqual(before)
  })

  it.each(['rated', 'dismissed'] as const)('an answered row (%s) never changes, even when the score does', async state => {
    await buildReadinessPayload('u1', TZ)
    const served = derived.get(today)!.readinessScore as number
    storeEarlierScore(served >= 50 ? -25 : 25)
    freezeVerdict(state)
    const before = structuredClone(verdicts.get(today))

    await buildReadinessPayload('u1', TZ)

    expect(derived.get(today)!.readinessScore).toBe(served)
    // The refresh ran (the score changed), saw the answer and stopped before any write.
    expect(repo.getReadinessVerdict).toHaveBeenCalled()
    expect(repo.refreshUnansweredReadinessVerdict).not.toHaveBeenCalled()
    expect(verdicts.get(today)).toEqual(before)
  })
})
