// Issue 3668, items 1 and 3 — two changes that must move nothing for today's data:
//
// - Item 1: the generic temperature normal is keyed by (source, algorithm version), as resting HR, HRV,
//   sleep balance and breathing already are. Each source sends one algorithm version today, so the
//   group is the same rows as before.
// - Item 3: readiness's low-wear rule reads the generic `DailyWear` shape a connector maps, never
//   Oura's `nonWearTimeSec` field.
//
// `fixtures/no-change-3668.json` was recorded on `main` before either change (RECORD_3668=1 writes a
// fresh copy to the temp dir); the change must reproduce it exactly. The inputs are the rows as the
// database holds them; only the `wire*` helpers turn them into each function's input, so they are the
// only part of this file a refactor may change. Model version strings are replaced by placeholders
// before anything is recorded or hashed (#3617), so a version bump is not read as an output change.
// Fixtures are seeded, so the recording is stable.
//
// The version-split case, where temperature is meant to restart its normal, is tested separately in
// `readiness-night-inputs-temperature-version-3668.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '@trainingai/shared/health/shadow-readiness/assemble'
import { scoreShadowReadiness } from '@trainingai/shared/health/shadow-readiness/score'
import { buildReadinessAudit } from '@trainingai/shared/health/score-audit/readiness'
import { restingHrBaseline } from '@trainingai/shared/health/activity-day'
import { nightAlgorithmVersion } from '@trainingai/shared/health/per-device-normal'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { ACTIVITY_MODEL_VERSION } from '@trainingai/shared/health/activity-score'
import { SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'
import { wearByDate } from '@trainingai/shared/health/wear-confidence'
import * as signalsMap from '@/lib/oura/cloud/readiness-signals-map'
import type { OuraDailySummaryRow } from '@/lib/data/repository'
import {
  resolveReadinessNightInputs, compositeNightFields, illnessNightFields,
  type NightInputSources, type RingSummaryInput,
} from '@/lib/health/readiness-night-inputs'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-change-3668.json')
const RECORD = process.env.RECORD_3668 === '1'
const recorded: Record<string, unknown> = {}

/** Model version strings out, so a bump is never an output change (#3617). */
function unversioned(value: unknown): unknown {
  let text = JSON.stringify(value) ?? 'null'
  for (const [v, tag] of [
    [READINESS_MODEL_VERSION, '<readiness-model-version>'],
    [ACTIVITY_MODEL_VERSION, '<activity-model-version>'],
    [SLEEP_SCORE_MODEL_VERSION, '<sleep-score-model-version>'],
  ] as const) text = text.split(v).join(tag)
  return JSON.parse(text)
}
function check(name: string, value: unknown) {
  const actual = unversioned(value)
  if (RECORD) { recorded[name] = actual; return }
  const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, unknown>
  expect(expected[name], `${name} was recorded on main`).toBeDefined()
  expect(actual).toEqual(expected[name])
}
/** A bulky value as a digest of its unversioned form. Numbers rounded to 1e-9. */
const digest = (v: unknown) => createHash('sha256')
  .update(JSON.stringify(unversioned(v), (_k, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x)))
  .digest('hex')

afterAll(() => {
  if (RECORD) writeFileSync(join(tmpdir(), 'no-change-3668.json'), JSON.stringify(recorded, null, 1) + '\n')
})

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// ── Stored rows, as the database holds them ─────────────────────────────────────────────────────

interface OuraDailyStored { date: string; nonWearTimeSec: number | null; temperatureDeviation: number | null; stressHigh: number | null }
interface Stored {
  today: string
  switchDay: string | null
  summaries: RingSummaryInput[]
  bodyMetrics: NightInputSources['bodyMetrics'][number][]
  nights: NightInputSources['nights'][number][]
  ouraDaily: OuraDailyStored[]
}

const RING = 'oura_ble'
const CLOUD = 'oura_cloud'
/** One algorithm version per source, as production holds today; some nights carry none. */
const VERSION: Record<string, string> = { [RING]: '1', [CLOUD]: '2.0' }
const LOW_WEAR = 50_000

type WearTonight = 'low' | 'ok' | 'null' | 'absent'

function stored(seed: number, today: string, switchDay: string | null, opts: { ringTonight?: boolean; wearTonight?: WearTonight; days?: number } = {}): Stored {
  const r = rng(seed)
  const days = opts.days ?? 40
  const out: Stored = { today, switchDay, summaries: [], bodyMetrics: [], nights: [], ouraDaily: [] }
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
        recoveryIndexHours: r() < 0.85 ? 3 + r() * 3 : null, tempDevC: r() < 0.9 ? (r() - 0.5) * 0.6 : null,
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
    if (r() < 0.9) {
      out.nights.push({
        date, durationHours: 6 + r() * 2.5, respiratoryRate: 13 + r() * 2,
        durationSource: src, respiratoryRateSource: src,
        sourceAlgorithmVersion: r() < 0.85 ? VERSION[src] : null,
      })
    }
    const wear: WearTonight = tonight ? (opts.wearTonight ?? 'ok') : (() => { const x = r(); return x < 0.15 ? 'low' : x < 0.25 ? 'null' : x < 0.3 ? 'absent' : 'ok' })()
    if (wear !== 'absent') {
      out.ouraDaily.push({
        date,
        nonWearTimeSec: wear === 'low' ? LOW_WEAR + Math.round(r() * 10_000) : wear === 'null' ? null : Math.round(r() * 3_000),
        temperatureDeviation: r() < 0.88 ? Math.round((r() - 0.5) * 80) / 100 : null,
        stressHigh: r() < 0.85 ? Math.round(r() * 120) * 60 : null,
      })
    }
  }
  return out
}

/** A stored night as the sleep-sessions table returns it. */
function sleepRow(n: Stored['nights'][number], i: number) {
  const end = new Date(`${n.date}T06:30:00+10:00`)
  return {
    id: `s${i}`, userId: 'u1', date: n.date, sleepStart: new Date(end.getTime() - n.durationHours! * 3_600_000), sleepEnd: end,
    durationHours: n.durationHours, deepSleepHours: 1.2, remSleepHours: 1.4, lightSleepHours: n.durationHours! - 3.1, awakHours: 0.5,
    respiratoryRate: n.respiratoryRate, createdAt: end,
    durationSource: n.durationSource, respiratoryRateSource: n.respiratoryRateSource, sourceAlgorithmVersion: n.sourceAlgorithmVersion,
  }
}

// ── The wiring: the only part a refactor may change ────────────────────────────────────────────

function wireNight(s: Stored): NightInputSources {
  return {
    today: s.today, summaries: s.summaries, bodyMetrics: s.bodyMetrics, nights: s.nights,
    temperatureDeviations: signalsMap.ouraTemperatureDeviations(s.ouraDaily), recoveryContributors: [], recoveryHours: [],
  }
}

/** The day's wear, as `restingHrBaseline` and the low-wear filters take it. */
function wireWear(s: Stored) {
  return wearByDate(signalsMap.ouraDailyWear(s.ouraDaily))
}

function wireShadow(s: Stored): ShadowRawHistory {
  return {
    tz: 'Australia/Brisbane', ageYears: 40,
    sleepSessions: [], bodyMetrics: s.bodyMetrics,
    dailySummaries: s.summaries.map(x => ({ date: x.date, recoveryIndexHours: x.recoveryIndexHours, tempDevC: x.tempDevC, breathAvgRpm: x.breathAvgRpm })),
    wear: signalsMap.ouraDailyWear(s.ouraDaily),
    temperatureDeviations: signalsMap.ouraTemperatureDeviations(s.ouraDaily), daytimeHighStress: signalsMap.ouraDaytimeHighStress(s.ouraDaily),
    derived: [], recoveryContributors: [], recoveryHours: [], ouraCloudFrom: s.switchDay,
    workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
  }
}

// ── Scenarios ──────────────────────────────────────────────────────────────────────────────────

const SWITCH = '2026-10-17'
const TODAYS = ['2026-10-12', SWITCH, '2026-10-24', '2026-11-06', '2026-07-08']
const VARIANTS: { ringTonight?: boolean; wearTonight?: WearTonight }[] = [
  {}, { ringTonight: false }, { wearTonight: 'low' }, { ringTonight: false, wearTonight: 'low' }, { wearTonight: 'null' }, { ringTonight: false, wearTonight: 'absent' },
]

function scenarios() {
  const out: { key: string; s: Stored }[] = []
  let seed = 3
  for (const today of TODAYS) {
    for (const [v, opts] of VARIANTS.entries()) {
      for (const sw of [SWITCH, '2026-09-20', null]) out.push({ key: `${today} v${v} switch=${sw}`, s: stored(seed++ * 89, today, sw, opts) })
    }
  }
  return out
}

describe('no readiness output moves when temperature is version-keyed and wear becomes a generic shape (#3668)', () => {
  it('the readiness night inputs, the composite fields and the illness fields', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const night = resolveReadinessNightInputs(wireNight(s))
      out[key] = { night, composite: compositeNightFields(night), illness: illnessNightFields(night) }
    }
    check('nightInputs', out)
  })

  it('the resting-HR baseline, low-wear days excluded', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      out[key] = [
        restingHrBaseline(s.bodyMetrics, wireWear(s)),
        restingHrBaseline(s.bodyMetrics, wireWear(s), nightAlgorithmVersion(s.nights)),
      ]
    }
    check('restingHrBaseline', out)
  })

  it('shadow readiness: the low-wear exclusions and every unit scored', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const prepared = prepareShadowHistory(wireShadow(s))
      out[key] = {
        excluded: [...prepared.excluded.entries()].sort(),
        scored: [shiftDateStr(s.today, -3), s.today].map(d => digest(scoreShadowReadiness(assembleShadowInputs(prepared, d)))),
      }
    }
    check('shadow', out)
  })

  it('the readiness score audit', () => {
    const out: Record<string, unknown> = {}
    for (const { key, s } of scenarios()) {
      const asSummary = (x: RingSummaryInput | undefined): OuraDailySummaryRow | null => x == null ? null : ({
        deepSleepHours: null, remSleepHours: null, sleepEfficiency: null, restlessPeriods: null, sleepLatencySec: null,
        rhrAvgBpm: null, metAvg: null, metBaseline: null, ...x,
      } as unknown as OuraDailySummaryRow)
      const audit = buildReadinessAudit({
        date: s.today, summary: asSummary(s.summaries.find(x => x.date === s.today)),
        priorSummary: asSummary([...s.summaries].filter(x => x.date < s.today).at(-1)),
        sleepScore: 78, activityScore: 64, ouraDaily: s.ouraDaily.find(r => r.date === s.today) ?? null, derived: null,
        switchDay: s.switchDay,
        generic: { bodyMetrics: s.bodyMetrics, nights: s.nights, temperatureDeviations: signalsMap.ouraTemperatureDeviations(s.ouraDaily), recoveryContributors: [], recoveryHours: [] },
      })
      out[key] = { all: digest(audit), score: audit.score, temperature: audit.contributors.find(c => c.key === 'temperature')?.input ?? null }
    }
    check('audit', out)
  })

  describe('the live readiness payload', () => {
    const TODAY = '2026-10-24'
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(`${TODAY}T05:00:00Z`))
    })
    afterEach(() => vi.useRealTimers())

    it('the score, the baselines and the low-wear qualifier', async () => {
      const tz = 'Australia/Brisbane'
      const out: Record<string, unknown> = {}
      let seed = 500
      for (const [v, opts] of VARIANTS.entries()) {
        for (const sw of [SWITCH, '2026-09-20', null]) {
          const s = stored(seed++ * 31, TODAY, sw, { ...opts, days: 36 })
          const fx = monthFixture(TODAY, tz)
          repo = {
            ...fixtureRepo(fx),
            listBodyMetrics: vi.fn(async (_u: string, from: string, to: string) => s.bodyMetrics.filter(r => r.date >= from && r.date <= to)),
            listSleepSessions: vi.fn(async (_u: string, from: string, to: string) => s.nights.filter(n => n.date >= from && n.date <= to).map(sleepRow)),
            getOuraDailySummary: vi.fn(async (_u: string, from: string, to: string) => s.summaries.filter(r => r.date >= from && r.date <= to)),
            getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => s.ouraDaily.filter(r => r.date >= from && r.date <= to)),
            getOuraCloudSwitchDay: vi.fn(async () => s.switchDay),
          }
          const p = await buildReadinessPayload('u1', tz)
          // `sleepScoreDate` is a field #3667 adds in the same PR (the date of the night the existing
          // `sleepScore` scored), not a score; it is left out of the digest so the recording from
          // `main` still stands for every value that was there.
          const { sleepScoreDate: _added, ...payloadOnMain } = p
          out[`v${v} switch=${sw}`] = {
            all: digest(payloadOnMain),
            readinessDisplayScore: p.readinessDisplayScore,
            readinessCompositeContributors: p.readinessCompositeContributors,
            baselineHrv: p.baselineHrv, recentHrv: p.recentHrv, restingHr: p.restingHr, restingHrBaseline: p.restingHrBaseline,
            isLowWearToday: p.isLowWearToday,
            temperatureDeviation: p.temperatureDeviation,
            illnessFlag: p.illnessFlag, illnessScore: p.illnessScore,
            stored: fx.derived.map(d => ({ day: d.day, readinessScore: d.readinessScore ?? null, readinessContributors: d.readinessContributors ?? null })),
          }
        }
      }
      check('payload', out)
    })
  })
})
