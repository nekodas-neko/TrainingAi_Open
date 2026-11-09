// Issue 3691 — two readers moved onto the version-keyed and generic shapes, which must move nothing
// for today's data:
//
// - Item 1: the night-temperature maturity count (`baselineNights` for an Oura deviation) counts only
//   the deviations in tonight's (source, algorithm version) group, over the same 60-day window. Each
//   source sends one algorithm version today, so the group is every deviation it counted before.
// - Item 2: the Body tab's Wear Time trend reads the generic `DailyWear` shape the Oura connector maps,
//   never Oura's `nonWearTimeSec` field.
//
// `fixtures/no-change-3691.json` was recorded on `main` before either change (RECORD_3691=1 writes a
// fresh copy to the temp dir); the change must reproduce it exactly. The scenarios cover one version
// per source, the ring-to-Oura source switch, nights with no version, and low, null and absent wear.
// The inputs are the rows as the database holds them, served by a fake repository that filters by
// date range as the real one does. Fixtures are seeded, so the recording is stable.
//
// The algorithm-version switch, where the count is meant to restart, is tested separately in
// `night-temperature-version-3691.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
let repo: Record<string, unknown>
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { loadNightTemperature } from '@/lib/health/night-temperature'
import { GET as trendsGET } from '@/app/api/health/trends/route'

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-change-3691.json')
const RECORD = process.env.RECORD_3691 === '1'
const recorded: Record<string, unknown> = {}

function check(name: string, value: unknown) {
  const actual = JSON.parse(JSON.stringify(value))
  if (RECORD) { recorded[name] = actual; return }
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, unknown>
  expect(expected[name], `${name} was recorded on main`).toBeDefined()
  expect(actual).toEqual(expected[name])
}

afterAll(() => {
  if (RECORD) writeFileSync(join(tmpdir(), 'no-change-3691.json'), JSON.stringify(recorded, null, 1) + '\n')
})

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// ── Stored rows, as the database holds them ─────────────────────────────────────────────────────

const RING = 'oura_ble'
const CLOUD = 'oura_cloud'
/** One algorithm version per source, as production holds today; some nights carry none. */
const VERSION: Record<string, string> = { [RING]: '1', [CLOUD]: 'v2' }

type WearTonight = 'low' | 'ok' | 'null' | 'absent'

interface Stored {
  today: string
  summaries: Record<string, unknown>[]
  bodyMetrics: Record<string, unknown>[]
  nights: { date: string; durationHours: number; respiratoryRate: number; durationSource: string; respiratoryRateSource: string; sourceAlgorithmVersion: string | null }[]
  ouraDaily: { date: string; nonWearTimeSec: number | null; temperatureDeviation: number | null }[]
}

function stored(seed: number, today: string, switchDay: string | null, opts: { ringTonight?: boolean; wearTonight?: WearTonight; tempTonight?: boolean } = {}): Stored {
  const r = rng(seed)
  const days = 75
  const out: Stored = { today, summaries: [], bodyMetrics: [], nights: [], ouraDaily: [] }
  for (let back = days - 1; back >= 0; back--) {
    const date = shiftDateStr(today, -back)
    const tonight = back === 0
    const afterSwitch = switchDay != null && date >= switchDay
    const src = afterSwitch ? CLOUD : RING
    const ring = tonight ? (opts.ringTonight ?? !afterSwitch) : !afterSwitch && r() < 0.9
    if (ring) {
      out.summaries.push({
        date, nHistory: 10 + days - back,
        rhrLowBpm: 50 + Math.round(r() * 6), hrvAvgMs: 50 + Math.round(r() * 15),
        tempMeanC: 36.2 + r() * 0.5, breathAvgRpm: 13.5 + r() * 1.5, sleepDurationHours: 6.5 + r() * 1.5,
        recoveryIndexHours: r() < 0.85 ? 3 + r() * 3 : null, tempDevC: r() < 0.8 ? (r() - 0.5) * 0.6 : null,
        rhrBaseline: { meanX8: 424 + Math.round(r() * 16), devX8: 24 }, hrvBaseline: { meanX8: 440 + Math.round(r() * 40), devX8: 48 },
        tempBaseline: { meanX8: 29000 + Math.round(r() * 200), devX8: 80 }, breathBaseline: { meanX8: 1120 + Math.round(r() * 40), devX8: 64 },
        sleepBaseline: { meanX8: 3500 + Math.round(r() * 300), devX8: 360 },
      })
    }
    if (r() < 0.93) {
      out.bodyMetrics.push({
        date, hrvMs: 45 + Math.round(r() * 20), restingHeartRate: 52 + Math.round(r() * 8),
        hrvSource: src, restingHeartRateSource: src,
      })
    }
    if (tonight || r() < 0.9) {
      out.nights.push({
        date, durationHours: 6 + r() * 2.5, respiratoryRate: 13 + r() * 2,
        durationSource: src, respiratoryRateSource: src,
        sourceAlgorithmVersion: r() < 0.85 ? VERSION[src] : null,
      })
    }
    const wear: WearTonight = tonight ? (opts.wearTonight ?? 'ok') : (() => { const x = r(); return x < 0.15 ? 'low' : x < 0.25 ? 'null' : x < 0.3 ? 'absent' : 'ok' })()
    const temp = tonight ? (opts.tempTonight ?? true) : r() < 0.88
    if (wear !== 'absent' || temp) {
      out.ouraDaily.push({
        date,
        nonWearTimeSec: wear === 'low' ? 50_000 + Math.round(r() * 10_000) : wear === 'ok' ? Math.round(r() * 3_000) : null,
        temperatureDeviation: temp ? Math.round((r() - 0.5) * 80) / 100 : null,
      })
    }
  }
  return out
}

/** A stored night as the sleep-sessions table returns it. */
function sleepRow(n: Stored['nights'][number], i: number) {
  const end = new Date(`${n.date}T06:30:00+10:00`)
  return {
    id: `s${i}`, userId: 'u1', date: n.date, sleepStart: new Date(end.getTime() - n.durationHours * 3_600_000), sleepEnd: end,
    durationHours: n.durationHours, deepSleepHours: 1.2, remSleepHours: 1.4, lightSleepHours: n.durationHours - 3.1, awakHours: 0.5,
    respiratoryRate: n.respiratoryRate, createdAt: end,
    durationSource: n.durationSource, respiratoryRateSource: n.respiratoryRateSource, sourceAlgorithmVersion: n.sourceAlgorithmVersion,
  }
}

const inRange = <T extends { date: string }>(rows: readonly T[], from: string, to: string) => rows.filter(r => r.date >= from && r.date <= to)

function fakeRepo(s: Stored) {
  return {
    getOuraDailySummary: vi.fn(async (_u: string, from: string, to: string) => inRange(s.summaries as { date: string }[], from, to)),
    listBodyMetrics: vi.fn(async (_u: string, from: string, to: string) => inRange(s.bodyMetrics as { date: string }[], from, to)),
    // The real adapter reads a day either side of the range.
    listSleepSessions: vi.fn(async (_u: string, from: string, to: string) => inRange(s.nights, shiftDateStr(from, -1), shiftDateStr(to, 1)).map(sleepRow)),
    getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => inRange(s.ouraDaily, from, to)),
    getOuraDailyDerived: vi.fn(async () => []),
    getWorkoutSessionsFrom: vi.fn(async () => []),
    listActivityLogs: vi.fn(async () => []),
    getHrForWindow: vi.fn(async () => []),
    getSetTimestampsForSession: vi.fn(async () => []),
  }
}

// ── Scenarios ──────────────────────────────────────────────────────────────────────────────────

const SWITCH = '2026-10-17'
const TODAYS = ['2026-10-12', SWITCH, '2026-10-24', '2026-11-06', '2026-12-20']
const VARIANTS: { ringTonight?: boolean; wearTonight?: WearTonight; tempTonight?: boolean }[] = [
  {}, { ringTonight: false }, { wearTonight: 'low' }, { ringTonight: false, wearTonight: 'null' },
  { ringTonight: false, wearTonight: 'absent' }, { ringTonight: false, tempTonight: false },
]

function scenarios() {
  const out: { key: string; s: Stored }[] = []
  let seed = 7
  for (const today of TODAYS) {
    for (const [v, opts] of VARIANTS.entries()) {
      for (const sw of [SWITCH, '2026-09-20', null]) out.push({ key: `${today} v${v} switch=${sw}`, s: stored(seed++ * 97, today, sw, opts) })
    }
  }
  return out
}

describe('no night-temperature or Wear Time value moves when they read the version-keyed, generic shapes (#3691)', () => {
  it('loadNightTemperature: the z, the deviation, its source and the maturity count', async () => {
    const out: Record<string, unknown> = {}
    let cloudCounted = 0
    for (const { key, s } of scenarios()) {
      const t = await loadNightTemperature(fakeRepo(s) as never, 'u1', s.today, TZ)
      if (t.deviationSource === 'cloud' && t.baselineNights > 0) cloudCounted++
      out[key] = t
    }
    // The recording exercises the Oura count, not only nights with none.
    expect(cloudCounted).toBeGreaterThan(10)
    check('nightTemperature', out)
  })

  describe('the 14-day trends route', () => {
    afterEach(() => vi.useRealTimers())
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))

    it('worn hours and temperature deviation per day', async () => {
      const out: Record<string, unknown> = {}
      for (const { key, s } of scenarios()) {
        // 14:00 local in Brisbane, so today's worn hours use a partial day.
        vi.setSystemTime(new Date(`${s.today}T04:00:00Z`))
        repo = fakeRepo(s)
        const res = await trendsGET()
        const { trends } = await res.json() as { trends: { date: string; wornHours: number | null; temperatureDeviation: number | null }[] }
        out[key] = trends.map(t => [t.date, t.wornHours, t.temperatureDeviation])
      }
      check('trends', out)
    })
  })
})
