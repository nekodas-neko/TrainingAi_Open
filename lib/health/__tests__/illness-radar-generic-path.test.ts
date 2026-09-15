// PS-42: `computeIllnessRadar` is built to degrade — its four signals are each optional and it
// renormalizes over whichever are present — but its only caller ran it ONLY when an
// `oura_daily_summary` row existed. So a user without a ring got no illness computation at all,
// not even the temperature-omitted one the formula was written for.
//
// Driven through the real `buildReadinessPayload` rather than the formula, because the formula was
// never the defect: the wiring was.
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

// Derived from the clock, never hardcoded: the payload builds its own 28-day window from today,
// so a fixed date walks out of that window and the fixture silently stops contributing.
// `shiftDateStr` rather than hand-rolled arithmetic: it is the repo's one calendar-day helper and
// it normalises month ends, which `d - 90` does not (a hand-added day once built 2026-06-31).
const dayIso = (daysAgo: number) => shiftDateStr(todayInTz(TZ), -daysAgo)

/** A Health-Connect-shaped history: resting HR and HRV per day, no ring anywhere. */
const genericBodyMetrics = (days: number, opts: { rhr: (i: number) => number; hrv: (i: number) => number }) =>
  Array.from({ length: days }, (_, i) => ({
    date: dayIso(days - 1 - i),
    restingHeartRate: opts.rhr(i),
    hrvMs: opts.hrv(i),
  }))

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

describe('illness radar on the generic (non-ring) path', () => {
  it('computes a radar for a user with no oura_daily_summary at all', async () => {
    repo.listBodyMetrics.mockResolvedValue(
      genericBodyMetrics(BASELINE_MIN_NIGHTS + 6, { rhr: () => 55, hrv: () => 70 }),
    )
    const out = await buildReadinessPayload('u1', TZ)

    expect(repo.getOuraDailySummary).toHaveBeenCalled()
    // The whole defect: every one of these was null for a ring-less user.
    expect(out.illnessFlag, 'no illness radar was produced for a ring-less user').not.toBeNull()
    expect(out.illnessBiomarkers).not.toBeNull()
  })

  it('omits the signals a generic source cannot supply, rather than approximating them', async () => {
    repo.listBodyMetrics.mockResolvedValue(
      genericBodyMetrics(BASELINE_MIN_NIGHTS + 6, { rhr: () => 55, hrv: () => 70 }),
    )
    const out = await buildReadinessPayload('u1', TZ)
    const markers = out.illnessBiomarkers ?? {}

    // Temperature and breathing have no generic source. They must be ABSENT, not zero — a zero
    // would be a claim about a measurement nobody took, and temperature carries the heaviest
    // weight in the formula.
    expect(markers).not.toHaveProperty('temperature')
    expect(markers).not.toHaveProperty('breathing')
  })

  // **This pins `signals.length === 0`, NOT the nHistory gate, and the difference is worth knowing.**
  // `trailingBaselineZ` needs BASELINE_MIN_NIGHTS *prior* samples before it returns a number at all,
  // so on this path a non-null z-score implies at least BASELINE_MIN_NIGHTS + 1 days of history,
  // which implies `genericNHistory >= BASELINE_MIN_NIGHTS`. The two gates are coupled: whenever
  // there is a signal to judge, the baseline is already mature. Mutating `nHistory` to a large
  // constant therefore changes nothing on the generic path — it is an equivalent mutant, not a hole
  // in this file. Leave both gates in place anyway; the coupling is an accident of the current
  // minimum, not a guarantee.
  it('stays in learning while the generic history is too short to produce a z-score', async () => {
    repo.listBodyMetrics.mockResolvedValue(
      genericBodyMetrics(3, { rhr: () => 55, hrv: () => 70 }),
    )
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.illnessFlag).toBe('learning')
    // Learning means no suppression: a cold user must never have readiness docked by this.
    expect(out.illnessSuppression).toBe(0)
    expect(out.illnessAdvisory).toBeNull()
  })

  it('produces nothing when there is no recovery signal at all', async () => {
    // No ring AND no generic history — there is no composite, so there is nothing to judge.
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.illnessFlag).toBeNull()
    expect(out.illnessBiomarkers).toBeNull()
    expect(out.illnessSuppression).toBe(0)
  })
})
