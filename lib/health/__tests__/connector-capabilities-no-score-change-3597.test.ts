// Issue 3597 — moving the source-specific rules in scoring onto connector capabilities is a pure
// refactor: for the same inputs every score is identical. `fixtures/no-score-change-3597.json` was
// recorded on `main` before the change (RECORD_3597=1 writes a fresh copy to the temp dir); the
// refactor must reproduce it exactly.
//
// It covers the four places the source ids lived: the heart-rate density rules and the moved-hour
// rule (Activity, live and finished), the per-minute movement grid (Activity's move lane, training
// load's MET/min and walk detection's device grid), and the switch-day rule (shadow readiness's
// daytime stress). Fixtures are seeded, so the snapshot is stable.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { loadActivityDay } from '@trainingai/shared/health/activity-day-load'
import { intradayHrContributors, dropSparseHrHours } from '@trainingai/shared/health/intraday-hr-contributors'
import { resolveDayMetPerMinute, deviceMetGrid } from '@trainingai/shared/health/met-input'
import { coverage } from '@trainingai/shared/inputs/cascade'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '@trainingai/shared/health/shadow-readiness/assemble'
import { scoreShadowReadiness } from '@trainingai/shared/health/shadow-readiness/score'
import { monthFixture, fixtureRepo, type ActivityFixture } from './fixtures/activity-day-fixtures'
import { movementGridForTest } from './fixtures/movement-grid-for-test'
import { ouraDaytimeHighStress } from '@/lib/oura/cloud/readiness-signals-map'

let repo: ReturnType<typeof fixtureRepo>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZS = ['Australia/Brisbane', 'Europe/London', 'America/Los_Angeles'] as const
const TODAY = '2026-10-08'
const YESTERDAY = shiftDateStr(TODAY, -1)
// 15:00 Brisbane on TODAY.
const NOW = new Date('2026-10-08T05:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

/** A small seeded generator, so every run builds the same fixtures. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// Every source string the density and moved-hour rules have ever named, plus ones they do not.
const SOURCES = ['oura', 'oura_ble', 'oura_cloud', 'health_connect', 'health_connect_native', 'apple_health', 'polar_h10', 'manual', null] as const

type HrRow = { timestamp: Date; bpm: number; source: string | null }

/** One day of heart rate from every source, each at its own cadence, some hours dense, some sparse. */
function hrForDay(date: string, tz: string, seed: number): HrRow[] {
  const r = rng(seed)
  const mid = dateStrMidnightInTz(date, tz).getTime()
  const rows: HrRow[] = []
  for (let h = 0; h < 24; h++) {
    // Each hour has zero to three sources, so some hours hold only a gated source's readings.
    const n = Math.floor(r() * 4)
    for (let k = 0; k < n; k++) {
      const source = SOURCES[Math.floor(r() * SOURCES.length)]
      // Gap between readings: 5 s (a workout), 2 min, 5 min, 10 min or ~17 min.
      const gapSec = [5, 120, 300, 600, 1020][Math.floor(r() * 5)]
      const startSec = Math.floor(r() * 900)
      const span = gapSec === 5 ? 600 : 3600 - startSec
      for (let t = startSec; t < startSec + span && t < 3600; t += gapSec) {
        rows.push({ timestamp: new Date(mid + h * 3_600_000 + t * 1000), bpm: 55 + Math.floor(r() * 110), source })
      }
    }
  }
  return rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

type CloudDay = NonNullable<ActivityFixture['cloudActivity']>[number]

/** Oura-shaped activity rows covering the day before and the day: MET at 60 s or 300 s, a wear class. */
function cloudForDay(date: string, tz: string, seed: number): CloudDay[] {
  const r = rng(seed)
  return [shiftDateStr(date, -1), date].map((d) => {
    const interval = r() < 0.5 ? 60 : 300
    // Oura's activity day starts at 4 a.m. local.
    const t0 = dateStrMidnightInTz(d, tz).getTime() + 4 * 3_600_000
    const n = Math.floor((24 * 3600) / interval)
    const items = Array.from({ length: n }, () => {
      const x = r()
      return x < 0.1 ? null : x < 0.6 ? 1 + r() * 0.7 : x < 0.8 ? 1.79 + r() * 0.02 : 1.8 + r() * 6
    })
    const class5Min = Array.from({ length: 288 }, () => String(Math.floor(r() * 6))).join('')
    return { date: d, met: { interval, items, timestamp: new Date(t0).toISOString() }, class5Min: r() < 0.2 ? null : class5Min }
  })
}

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-score-change-3597.json')
const RECORD = process.env.RECORD_3597 === '1'
const recorded: Record<string, unknown> = {}
/** Compare against the copy recorded on `main` (JSON round trip on both sides). */
function check(name: string, value: unknown) {
  const actual = JSON.parse(JSON.stringify(value))
  if (RECORD) { recorded[name] = actual; return }
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, unknown>
  expect(expected[name], `${name} was recorded on main`).toBeDefined()
  expect(actual).toEqual(expected[name])
}
afterAll(() => {
  if (RECORD) writeFileSync(join(tmpdir(), 'no-score-change-3597.json'), JSON.stringify(recorded, null, 1) + '\n')
})

/** A long per-minute series as a digest, so the recorded copy stays small. Values rounded to 1e-9. */
const digest = (xs: readonly (number | string | null)[]) =>
  createHash('sha256').update(JSON.stringify(xs.map((v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)))).digest('hex')

const typedRepo = () => repo as unknown as Parameters<typeof loadActivityDay>[0]

describe('no score moves when the source rules become capabilities (#3597)', () => {
  it('Activity, finished and live, over every source mix', async () => {
    const out: Record<string, unknown> = {}
    for (const [i, tz] of TZS.entries()) {
      for (const variant of ['hr+met', 'hr only', 'met only', 'no resting hr'] as const) {
        const fx = monthFixture(TODAY, tz)
        fx.hr = variant === 'met only' ? [] : [
          ...hrForDay(YESTERDAY, tz, 11 + i),
          ...hrForDay(TODAY, tz, 23 + i).filter((h) => h.timestamp.getTime() < NOW.getTime()),
        ]
        fx.cloudActivity = variant === 'hr only' ? [] : [...cloudForDay(YESTERDAY, tz, 37 + i), ...cloudForDay(TODAY, tz, 41 + i).slice(1)]
        if (variant === 'no resting hr') fx.metrics = fx.metrics.map((m) => ({ ...m, restingHeartRate: null }))
        for (const date of [YESTERDAY, TODAY]) {
          repo = fixtureRepo(fx)
          const day = await loadActivityDay(typedRepo(), 'u1', tz, date)
          out[`${tz} ${variant} ${date}`] = { score: day.result?.score ?? null, components: day.result?.components ?? null, signals: day.signals }
        }
      }
    }
    check('activity', out)
  })

  it('the readiness payload\'s live Activity', async () => {
    const tz = 'Australia/Brisbane'
    const fx = monthFixture(TODAY, tz)
    fx.hr = [...hrForDay(YESTERDAY, tz, 5), ...hrForDay(TODAY, tz, 6).filter((h) => h.timestamp.getTime() < NOW.getTime())]
    fx.cloudActivity = [...cloudForDay(YESTERDAY, tz, 7), ...cloudForDay(TODAY, tz, 8).slice(1)]
    repo = fixtureRepo(fx)
    const p = await buildReadinessPayload('u1', tz)
    check('readinessPayload', {
      activityScore: p.activityScore, activityContributors: p.activityContributors,
      activityGoals: p.activityGoals, activitySignals: p.activitySignals,
      stored: fx.derived.map((d) => ({ day: d.day, activityScore: d.activityScore ?? null })),
    })
  })

  it('the density rule and both intraday contributors, directly', () => {
    const out: unknown[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const tz = TZS[seed % TZS.length]
      const date = shiftDateStr(TODAY, -(seed % 9))
      const hrRows = hrForDay(date, tz, seed * 7)
      const grid = seed % 4 === 0 ? null : movementGridForTest(cloudForDay(date, tz, seed * 13), dateStrMidnightInTz(date, tz).getTime(), dateStrMidnightInTz(shiftDateStr(date, 1), tz).getTime())
      const sparse = dropSparseHrHours(hrRows, tz)
      out.push({
        seed,
        kept: sparse.rows.length,
        sparseHours: sparse.sparseHours,
        contributors: intradayHrContributors({
          hrRows, maxHr: 185, restingHr: seed % 5 === 0 ? null : 50 + (seed % 12), tz, dateIso: date,
          metGrid: grid, dayIsOver: seed % 3 !== 0,
        }),
      })
    }
    check('intraday', out)
  })

  it('the per-minute movement grid, and MET/min through the cascade', () => {
    const out: unknown[] = []
    for (let seed = 1; seed <= 12; seed++) {
      const tz = TZS[seed % TZS.length]
      const from = dateStrMidnightInTz(TODAY, tz).getTime()
      const to = dateStrMidnightInTz(shiftDateStr(TODAY, 1), tz).getTime()
      const cloud = movementGridForTest(cloudForDay(TODAY, tz, seed * 3), from, to)
      const r = rng(seed)
      const ringGrid = { startTimestampMs: from, metsPerMinute: Array.from({ length: 1440 }, () => (r() < 0.7 ? null : 1 + r() * 4)) }
      const met = resolveDayMetPerMinute({
        ringGrid, movementGrid: cloud, ringStillFramesMs: [], sleepSessions: [{ startMs: from, endMs: from + 6 * 3_600_000, source: 'sleep_record' }],
        activities: [{ startMs: from + 17 * 3_600_000, endMs: from + 18 * 3_600_000, met: 7 }],
      }, from, to)
      const device = deviceMetGrid(ringGrid, cloud, from, to)
      out.push({
        seed,
        grid: { start: cloud.startTimestampMs, n: cloud.metsPerMinute.length, worn: cloud.metsPerMinute.filter((v) => v != null).length, values: digest(cloud.metsPerMinute) },
        mix: met.mix,
        coverage: coverage(met.series),
        metsPerMinute: digest(met.metsPerMinute),
        provenance: digest(met.series.map((s) => s.provenance?.source ?? null)),
        device: digest(device.metsPerMinute),
      })
    }
    check('movementGrid', out)
  })

  it('shadow readiness\'s daytime stress on both sides of a switch day', () => {
    const SWITCH = '2026-10-18'
    const raw = (from: string | null): ShadowRawHistory => ({
      tz: 'Australia/Brisbane', ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], workouts: [], program: null,
      setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
      derived: Array.from({ length: 40 }, (_, i) => ({ day: shiftDateStr(SWITCH, 5 - i), stressHighMinutes: 30 + (i % 7) })),
      wear: Array.from({ length: 40 }, (_, i) => ({ date: shiftDateStr(SWITCH, 5 - i), nonWearTimeSec: 0 })),
      // #3610: Oura's `stress_high` reaches shadow readiness through the connector's mapping.
      daytimeHighStress: ouraDaytimeHighStress(Array.from({ length: 40 }, (_, i) => ({ date: shiftDateStr(SWITCH, 5 - i), stressHigh: 1800 + (i % 9) * 300 }))),
      ouraCloudFrom: from,
    })
    const out = [SWITCH, null].map((from) => {
      const prepared = prepareShadowHistory(raw(from))
      return {
        from,
        series: prepared.series['body.daytime_stress'],
        scored: [shiftDateStr(SWITCH, -2), SWITCH, shiftDateStr(SWITCH, 3)].map((d) => scoreShadowReadiness(assembleShadowInputs(prepared, d)).units['body.daytime_stress']),
      }
    })
    check('shadowStress', out)
  })
})
