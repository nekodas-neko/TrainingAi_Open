// Issue 2435 — shared fixtures for the Activity-score-for-a-day tests: a mocked repository that
// answers every read `buildReadinessPayload` and the activity finalise make, from in-memory rows
// filtered by the same bounds the real queries use.
import { vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'

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
    getActiveProgram: vi.fn(async () => fx.program),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      fx.hr.filter(r => r.timestamp.getTime() >= from.getTime() && r.timestamp.getTime() < to.getTime())),
    getOuraDailySummary: vi.fn(async () => [] as unknown[]),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      fx.derived.filter(r => r.day >= from && r.day <= to).sort((a, b) => a.day.localeCompare(b.day))
        .map(r => ({ activityScore: null, activityContributors: null, ...r }))),
    getLatestOuraCloudVitals: vi.fn(async () => null),
    getUserById: vi.fn(async () => ({ dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180, activityLevel: 'moderate' })),
    getUserGoals: vi.fn(async () => ({ stepsGoal: null })),
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
