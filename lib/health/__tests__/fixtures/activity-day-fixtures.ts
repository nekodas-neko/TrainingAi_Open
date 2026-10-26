// Issue 2435 — shared fixtures for the Activity-score-for-a-day tests: a mocked repository that
// answers every read `buildReadinessPayload` and the activity finalise make, from in-memory rows
// filtered by the same bounds the real queries use.
import { vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { EMPTY_OBSERVED_HR } from '@trainingai/shared/health/observed-hr'

export interface FixtureMetric {
  date: string
  steps?: number | null
  activeCalories?: number | null
  restingHeartRate?: number | null
  hrvMs?: number | null
  weightKg?: number | null
}
export interface FixtureSession { id: string; startedAt: Date; exercises: { volume: number | null }[] }
export interface FixtureDerived { day: string; activityScore?: number | null; activityContributors?: unknown; [k: string]: unknown }

export interface ActivityFixture {
  metrics: FixtureMetric[]
  hr: { timestamp: Date; bpm: number; source: string | null }[]
  sessions: FixtureSession[]
  derived: FixtureDerived[]
  program: Record<string, unknown> | null
  /** `oura_cloud_daily` activity rows (#3114): the MET series that decides the move lane. */
  cloudActivity?: { date: string; met: { interval: number; items: (number | null)[]; timestamp: string } | null; class5Min: string | null }[]
  /** Makes the MET read throw, as a database or connector error would. */
  cloudActivityFails?: boolean
  /** When each Oura day's `oura_cloud_daily` row last changed (#3079), for days that carry MET. */
  metChangedAt?: { date: string; changedAt: Date }[]
  /** Reads the finalise must not swallow on a finished day: each throws, as a database error would. */
  failReads?: { goals?: boolean; user?: boolean; observedHr?: boolean; fitnessTests?: boolean }
  /** Logged activities, for the treadmill steps that join a day's count (#3134). */
  activityLogs?: { date: string; activityType: string; steps?: number | null }[]
}

/** A repository over the fixture. Upserts land in `fixture.derived` with the real COALESCE rule. */
export function fixtureRepo(fx: ActivityFixture) {
  const coalesceUpsert = async (_u: string, day: string, patch: Record<string, unknown>) => {
    let row = fx.derived.find(r => r.day === day)
    if (!row) { row = { day }; fx.derived.push(row) }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      if (k === 'modelVersions') row[k] = { ...((row[k] as object) ?? {}), ...((v as object) ?? {}) }
      else if (v !== null) row[k] = v
    }
  }
  return {
    listBodyMetrics: vi.fn(async (_u: string, from: string, to: string) =>
      fx.metrics.filter(m => m.date >= from && m.date <= to).sort((a, b) => a.date.localeCompare(b.date))),
    listSleepSessions: vi.fn(async () => [] as unknown[]),
    getWorkoutSessionsFrom: vi.fn(async (_u: string, from: Date) =>
      fx.sessions.filter(s => s.startedAt.getTime() >= from.getTime())),
    getOuraDaily: vi.fn(async () => [] as unknown[]),
    getOuraCloudActivitySeries: vi.fn(async (_u: string, from: string, to: string) => {
      if (fx.cloudActivityFails) throw new Error('oura_cloud_daily read failed')
      return (fx.cloudActivity ?? []).filter(r => r.date >= from && r.date <= to)
    }),
    getActiveProgram: vi.fn(async () => fx.program),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      fx.hr.filter(r => r.timestamp.getTime() >= from.getTime() && r.timestamp.getTime() < to.getTime())),
    getOuraDailySummary: vi.fn(async () => [] as unknown[]),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      fx.derived.filter(r => r.day >= from && r.day <= to).sort((a, b) => a.day.localeCompare(b.day))
        .map(r => ({ activityScore: null, activityContributors: null, ...r }))),
    getLatestOuraCloudVitals: vi.fn(async () => null),
    getOuraCloudMetChangedAt: vi.fn(async (_u: string, from: string, to: string) =>
      (fx.metChangedAt ?? []).filter(r => r.date >= from && r.date <= to)),
    getObservedHrProfile: vi.fn(async () => {
      if (fx.failReads?.observedHr) throw new Error('observed hr read failed')
      return EMPTY_OBSERVED_HR
    }),
    listFitnessTests: vi.fn(async () => {
      if (fx.failReads?.fitnessTests) throw new Error('fitness tests read failed')
      return [] as unknown[]
    }),
    getUserById: vi.fn(async () => {
      if (fx.failReads?.user) throw new Error('user read failed')
      return ({ dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180, activityLevel: 'moderate' })
    }),
    getUserGoals: vi.fn(async () => {
      if (fx.failReads?.goals) throw new Error('goals read failed')
      return { stepsGoal: null }
    }),
    listActivityLogs: vi.fn(async (_u: string, from: string, to: string) =>
      (fx.activityLogs ?? []).filter(a => a.date >= from && a.date <= to)),
    listDoseEvents: vi.fn(async () => [] as unknown[]),
    listProgramPhases: vi.fn(async () => [] as unknown[]),
    countSessionsSinceStart: vi.fn(async () => 0),
    upsertOuraDailyDerived: vi.fn(coalesceUpsert),
  }
}

/** HR every 5 minutes across `[fromHour, toHour)` local on `date`, with `hot` hours at `hotBpm`. */
export function hrDay(date: string, tz: string, fromHour: number, toHour: number, restBpm: number, hot: Record<number, number>) {
  const mid = dateStrMidnightInTz(date, tz).getTime()
  const rows: ActivityFixture['hr'] = []
  for (let h = fromHour; h < toHour; h++) {
    for (let m = 0; m < 60; m += 5) {
      rows.push({ timestamp: new Date(mid + (h * 60 + m) * 60_000), bpm: hot[h] ?? restBpm, source: 'oura' })
    }
  }
  return rows
}

/**
 * A month of history ending on `today`: resting HR and HRV every day (so the baselines are mature),
 * steps and active energy every day, a strength session every third day, and weight.
 * `todaySteps` lets a test make today's partial day near-empty.
 */
export function monthFixture(today: string, tz: string, opts: { todaySteps?: number | null; todayKcal?: number | null; heavyWeek?: boolean } = {}): ActivityFixture {
  const metrics: FixtureMetric[] = []
  const sessions: FixtureSession[] = []
  for (let back = 35; back >= 0; back--) {
    const date = shiftDateStr(today, -back)
    metrics.push({
      date,
      steps: back === 0 ? (opts.todaySteps === undefined ? 4200 : opts.todaySteps) : 6000 + (back % 7) * 900,
      activeCalories: back === 0 ? (opts.todayKcal === undefined ? 210 : opts.todayKcal) : 420 + (back % 5) * 35,
      restingHeartRate: 56 + (back % 3),
      hrvMs: 60 + (back % 4),
      weightKg: back % 4 === 0 ? 82 : null,
    })
    if (back % 3 === 0) {
      const heavy = opts.heavyWeek && back <= 6
      sessions.push({
        id: `s${back}`,
        startedAt: new Date(dateStrMidnightInTz(date, tz).getTime() + 7 * 3_600_000),
        exercises: [{ volume: heavy ? 14_000 : 5_200 }, { volume: heavy ? 6_000 : 2_100 }],
      })
    }
  }
  return {
    metrics,
    hr: [
      ...hrDay(shiftDateStr(today, -2), tz, 6, 22, 64, { 7: 128, 12: 110, 17: 104 }),
      ...hrDay(shiftDateStr(today, -1), tz, 6, 22, 66, { 7: 132, 9: 112, 13: 108, 18: 115 }),
      ...hrDay(today, tz, 6, 15, 68, { 7: 125, 11: 105 }),
    ],
    sessions,
    derived: [],
    program: { id: 'p1', phaseMode: 'manual', startedAt: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z') },
  }
}
