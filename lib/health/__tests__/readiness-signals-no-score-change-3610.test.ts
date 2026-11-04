// Issue 3610 — mapping Oura's readiness fields (temperature deviation, the recovery-index contributor,
// daytime high-stress minutes, and our hours from its heart-rate series) into generic shapes before
// readiness reads them is a pure refactor: for the same stored rows every output is identical.
// `fixtures/no-score-change-3610.json` was recorded on `main` before the change (RECORD_3610=1 writes
// a fresh copy to the temp dir); the refactor must reproduce it exactly.
//
// The inputs below are the rows as the database holds them. Only the `wire*` helpers and the repo
// overrides turn them into each function's input, so they are the only part of this file a refactor
// may change. Covered: the readiness night inputs, shadow readiness's three series and its scores,
// the readiness score audit's text, and the live readiness payload, each on both sides of a source
// switch and of the re-key date. Fixtures are seeded, so the recording is stable.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '@trainingai/shared/health/shadow-readiness/assemble'
import { scoreShadowReadiness } from '@trainingai/shared/health/shadow-readiness/score'
import { buildReadinessAudit } from '@trainingai/shared/health/score-audit/readiness'
import type { OuraDailySummaryRow } from '@/lib/data/repository'
import {
  resolveReadinessNightInputs, compositeNightFields, illnessNightFields, readinessSourceLabel,
  type NightInputSources, type RingSummaryInput,
} from '@/lib/health/readiness-night-inputs'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-score-change-3610.json')
const RECORD = process.env.RECORD_3610 === '1'
const recorded: Record<string, unknown> = {}
/** Compare against the copy recorded on `main` (JSON round trip on both sides). */
function check(name: string, value: unknown) {
  const actual = JSON.parse(JSON.stringify(value))
  if (RECORD) { recorded[name] = actual; return }
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, unknown>
  expect(expected[name], `${name} was recorded on main`).toBeDefined()
  expect(actual).toEqual(expected[name])
}
/** A bulky value as a digest, so the recorded copy stays small. Numbers rounded to 1e-9. */
const digest = (v: unknown) => createHash('sha256')
  .update(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x)))
  .digest('hex')

/** A shadow series as its digest plus how many observations each source label holds. */
function series(xs: readonly { source?: string | null }[] | undefined) {
  const bySource: Record<string, number> = {}
  for (const o of xs ?? []) bySource[String(o.source)] = (bySource[String(o.source)] ?? 0) + 1
  return { digest: digest(xs ?? []), bySource }
}

afterAll(() => {
  if (RECORD) writeFileSync(join(tmpdir(), 'no-score-change-3610.json'), JSON.stringify(recorded, null, 1) + '\n')
})

/** A small seeded generator, so every run builds the same fixtures. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// ── Stored rows, as the database holds them ─────────────────────────────────────────────────────

/** An `oura_daily` row's readiness-relevant columns. */
interface OuraDailyStored { date: string; nonWearTimeSec: number | null; temperatureDeviation: number | null; stressHigh: number | null }
/** An `oura_cloud_daily.readiness_contributors` row. */
interface ContributorStored { date: string; readinessContributors: Record<string, number | null> | null }
/** `getOuraCloudRecoveryIndexHours`'s row on `main`. */
interface HoursStored { date: string; hours: number }

interface Stored {
  today: string
  switchDay: string | null
  summaries: RingSummaryInput[]
  bodyMetrics: NightInputSources['bodyMetrics'][number][]
  nights: NightInputSources['nights'][number][]
  ouraDaily: OuraDailyStored[]
  contributors: ContributorStored[]
  hours: HoursStored[]
}

const RING = 'oura_ble'
const CLOUD = 'oura_cloud'

/**
 * `days` days of history ending `today`. Before `switchDay` the ring's summary and the ring-labelled
 * generic rows; from it, partial ring rows and Oura Cloud's values. Oura's daily rows, contributors
 * and hours cover the whole span (the older ones are the pre-re-key Cloud history), with gaps.
 */
function stored(seed: number, today: string, switchDay: string | null, days = 40, opts: { ringTonight?: 'full' | 'partial' | 'none'; tempTonight?: boolean; hoursTonight?: boolean; contributorTonight?: 'number' | 'null' | 'absent' | 'no-key' } = {}): Stored {
  const r = rng(seed)
  const out: Stored = { today, switchDay, summaries: [], bodyMetrics: [], nights: [], ouraDaily: [], contributors: [], hours: [] }
  for (let back = days - 1; back >= 0; back--) {
    const date = shiftDateStr(today, -back)
    const tonight = back === 0
    const afterSwitch = switchDay != null && date >= switchDay
    const src = afterSwitch ? CLOUD : RING
    const ringMode = tonight ? (opts.ringTonight ?? (afterSwitch ? 'partial' : 'full')) : (afterSwitch ? (r() < 0.5 ? 'partial' : 'none') : 'full')
    if (ringMode !== 'none') {
      const full = ringMode === 'full'
      out.summaries.push({
        date, nHistory: 10 + days - back,
        rhrLowBpm: full ? 50 + Math.round(r() * 6) : null,
        hrvAvgMs: full ? 50 + Math.round(r() * 15) : null,
        tempMeanC: full ? 36.2 + r() * 0.5 : null,
        breathAvgRpm: full ? 13.5 + r() * 1.5 : null,
        sleepDurationHours: full ? 6.5 + r() * 1.5 : null,
        recoveryIndexHours: full && r() < 0.85 ? 3 + r() * 3 : null,
        tempDevC: full && r() < 0.9 ? (r() - 0.5) * 0.6 : null,
        rhrBaseline: full ? { meanX8: 424 + Math.round(r() * 16), devX8: 24 } : null,
        hrvBaseline: full ? { meanX8: 440 + Math.round(r() * 40), devX8: 48 } : null,
        tempBaseline: full ? { meanX8: 29000 + Math.round(r() * 200), devX8: 80 } : null,
        breathBaseline: full ? { meanX8: 1120 + Math.round(r() * 40), devX8: 64 } : null,
        sleepBaseline: full ? { meanX8: 3500 + Math.round(r() * 300), devX8: 360 } : null,
      })
    }
    if (r() < 0.92) {
      out.bodyMetrics.push({
        date, hrvMs: 45 + Math.round(r() * 20), restingHeartRate: 52 + Math.round(r() * 8),
        hrvSource: src, restingHeartRateSource: src,
      })
    }
    if (r() < 0.9) {
      out.nights.push({
        date, durationHours: 6 + r() * 2.5, respiratoryRate: 13 + r() * 2,
        durationSource: src, respiratoryRateSource: src,
      })
    }
    const temp = tonight ? (opts.tempTonight ?? true) : r() < 0.85
    out.ouraDaily.push({
      date,
      nonWearTimeSec: r() < 0.1 ? 50_000 : Math.round(r() * 3_000),
      temperatureDeviation: temp ? Math.round((r() - 0.5) * 80) / 100 : null,
      stressHigh: r() < 0.85 ? Math.round(r() * 120) * 60 + (r() < 0.2 ? 17 : 0) : null,
    })
    const contributorMode = tonight ? (opts.contributorTonight ?? 'number') : (r() < 0.8 ? 'number' : r() < 0.5 ? 'null' : r() < 0.5 ? 'no-key' : 'absent')
    if (contributorMode === 'number') out.contributors.push({ date, readinessContributors: { recovery_index: 40 + Math.round(r() * 60), hrv_balance: 70 } })
    else if (contributorMode === 'null') out.contributors.push({ date, readinessContributors: { recovery_index: null } })
    else if (contributorMode === 'no-key') out.contributors.push({ date, readinessContributors: null })
    const hours = tonight ? (opts.hoursTonight ?? false) : r() < 0.5
    if (hours) out.hours.push({ date, hours: Math.round((2 + r() * 4) * 100) / 100 })
  }
  return out
}

// ── The wiring: the only part a refactor may change ────────────────────────────────────────────

function wireNight(s: Stored): NightInputSources {
  return {
    today: s.today, summaries: s.summaries, bodyMetrics: s.bodyMetrics, nights: s.nights,
    ouraDaily: s.ouraDaily, ouraCloudContributors: s.contributors, ouraCloudRecoveryHours: s.hours,
  }
}

function wireShadow(s: Stored): ShadowRawHistory {
  return {
    tz: 'Australia/Brisbane', ageYears: 40,
    sleepSessions: [], bodyMetrics: s.bodyMetrics,
    dailySummaries: s.summaries.map(x => ({ date: x.date, recoveryIndexHours: x.recoveryIndexHours, tempDevC: x.tempDevC, breathAvgRpm: x.breathAvgRpm })),
    wear: s.ouraDaily,
    derived: s.ouraDaily.filter((_, i) => i % 3 !== 0).map((w, i) => ({ day: w.date, stressHighMinutes: 20 + (i % 11) * 4, stillRhrBpm: null })),
    ouraCloudContributors: s.contributors, ouraCloudRecoveryHours: s.hours, ouraCloudFrom: s.switchDay,
    workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
  }
}

function wireAuditGeneric(s: Stored) {
  return { bodyMetrics: s.bodyMetrics, nights: s.nights, ouraDaily: s.ouraDaily, ouraCloudContributors: s.contributors, ouraCloudRecoveryHours: s.hours }
}

/** The repo reads the live payload makes for these four signals. */
function wireRepo(s: Stored) {
  return {
    getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => s.ouraDaily.filter(r => r.date >= from && r.date <= to)),
    getOuraCloudReadinessContributors: vi.fn(async (_u: string, from: string, to: string) => s.contributors.filter(r => r.date >= from && r.date <= to)),
    getOuraCloudRecoveryIndexHours: vi.fn(async (_u: string, dates: string[]) => s.hours.filter(r => dates.includes(r.date))),
  }
}

// ── Scenarios ──────────────────────────────────────────────────────────────────────────────────

const SWITCH = '2026-10-17'
/** Dates either side of the switch, and either side of the re-key date (2026-07-07). */
const TODAYS = ['2026-10-12', '2026-10-16', SWITCH, '2026-10-18', '2026-10-24', '2026-07-05', '2026-07-07', '2026-07-08', '2026-07-20']
const VARIANTS = [
  {},
  { ringTonight: 'none', hoursTonight: true },
  { ringTonight: 'partial', hoursTonight: false, contributorTonight: 'number' },
  { ringTonight: 'partial', hoursTonight: false, contributorTonight: 'null' },
  { ringTonight: 'none', contributorTonight: 'absent', tempTonight: false },
  { ringTonight: 'full', hoursTonight: true, contributorTonight: 'no-key' },
] as const

function scenarios() {
  const out: { key: string; s: Stored }[] = []
  let seed = 1
  for (const today of TODAYS) {
    for (const [v, opts] of VARIANTS.entries()) {
      for (const sw of [SWITCH, null]) {
        out.push({ key: `${today} v${v} switch=${sw}`, s: stored(seed++ * 97, today, sw, 40, opts) })
      }
    }
  }
  return out
}

describe('no readiness output moves when Oura\'s readiness fields become generic shapes (#3610)', () => {
  it('the readiness night inputs, the composite fields and the illness fields', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const night = resolveReadinessNightInputs(wireNight(s))
      out[key] = {
        night,
        composite: compositeNightFields(night),
        illness: illnessNightFields(night),
        label: readinessSourceLabel(night, s.summaries.length > 0, s.switchDay),
      }
    }
    check('nightInputs', out)
  })

  it('shadow readiness: temperature, overnight settling and daytime stress, and every unit scored', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const prepared = prepareShadowHistory(wireShadow(s))
      out[key] = {
        temperature: series(prepared.series['body.temperature']),
        settling: series(prepared.series['heart.overnight_settling']),
        stress: series(prepared.series['body.daytime_stress']),
        excluded: digest([...prepared.excluded.entries()]),
        scored: [shiftDateStr(s.today, -3), s.today].map(d => {
          const r = scoreShadowReadiness(assembleShadowInputs(prepared, d))
          const pick = (id: 'body.temperature' | 'heart.overnight_settling' | 'body.daytime_stress') => {
            const u = r.units[id]
            return u == null ? null : { value: u.value, source: u.provenance?.source ?? null, score: u.score, validDays: u.validDays, gap: u.gap }
          }
          return { all: digest(r), temperature: pick('body.temperature'), settling: pick('heart.overnight_settling'), stress: pick('body.daytime_stress') }
        }),
      }
    }
    check('shadow', out)
  })

  it('the readiness score audit, text included', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const asSummary = (x: RingSummaryInput | undefined): OuraDailySummaryRow | null => x == null ? null : ({
        deepSleepHours: null, remSleepHours: null, sleepEfficiency: null, restlessPeriods: null, sleepLatencySec: null,
        rhrAvgBpm: null, metAvg: null, metBaseline: null, ...x,
      } as unknown as OuraDailySummaryRow)
      const summary = asSummary(s.summaries.find(x => x.date === s.today))
      const priorSummary = asSummary([...s.summaries].filter(x => x.date < s.today).at(-1))
      const ouraToday = s.ouraDaily.find(r => r.date === s.today) ?? null
      const audit = buildReadinessAudit({
        date: s.today, summary, priorSummary, sleepScore: 78, activityScore: 64,
        ouraDaily: ouraToday, derived: null, switchDay: s.switchDay,
        generic: wireAuditGeneric(s),
      })
      out[key] = {
        all: digest(audit),
        score: audit.score,
        recoveryIndex: audit.contributors.find(c => c.key === 'recoveryIndex')?.input ?? null,
        temperature: audit.contributors.find(c => c.key === 'temperature')?.input ?? null,
        gaps: audit.gaps,
        notes: audit.notes,
      }
    }
    check('audit', out)
  })

  describe('the live readiness payload', () => {
    const NOW = new Date('2026-10-24T05:00:00Z')
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })
    afterEach(() => vi.useRealTimers())

    it('reads the same night, temperature and recovery index', async () => {
      const tz = 'Australia/Brisbane'
      const out: Record<string, unknown> = {}
      for (const [v, opts] of VARIANTS.entries()) {
        for (const sw of [SWITCH, null]) {
          const s = stored(1000 + v * 7 + (sw ? 1 : 0), '2026-10-24', sw, 36, opts)
          const fx = monthFixture('2026-10-24', tz)
          repo = {
            ...fixtureRepo(fx),
            listBodyMetrics: vi.fn(async (_u: string, from: string, to: string) => s.bodyMetrics.filter(r => r.date >= from && r.date <= to)),
            getOuraDailySummary: vi.fn(async (_u: string, from: string, to: string) => s.summaries.filter(r => r.date >= from && r.date <= to)),
            getOuraCloudSwitchDay: vi.fn(async () => s.switchDay),
            ...wireRepo(s),
          }
          const p = await buildReadinessPayload('u1', tz)
          out[`v${v} switch=${sw}`] = {
            readinessDisplayScore: p.readinessDisplayScore,
            readinessCompositeContributors: p.readinessCompositeContributors,
            temperatureDeviation: p.temperatureDeviation,
            temperatureDeviationSource: p.temperatureDeviationSource,
            illnessFlag: p.illnessFlag, illnessScore: p.illnessScore, illnessBiomarkers: p.illnessBiomarkers,
            stressHigh: p.stressHigh,
            stored: fx.derived.map(d => ({ day: d.day, readinessScore: d.readinessScore ?? null, readinessSource: d.readinessSource ?? null, readinessContributors: d.readinessContributors ?? null })),
          }
        }
      }
      check('payload', out)
    })
  })
})
