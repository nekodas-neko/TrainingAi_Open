// Issues 3613 and 3616 — two refactors that must move nothing:
//
// - #3613: readiness's per-night inputs look a reading's algorithm version up through the shared
//   `nightAlgorithmVersion` rather than their own inline copy of the same rule.
// - #3616: Body Battery's stress drain and the readiness payload's stress and recovery display read
//   daytime stress (and recovery) through the generic shapes a connector maps, never Oura's own
//   `stressHigh` / `recoveryHigh` fields.
//
// `fixtures/no-change-3613-3616.json` was recorded on `main` before either change (RECORD_3613=1
// writes a fresh copy to the temp dir); the refactor must reproduce it exactly. Model version strings
// are replaced by placeholders before anything is recorded or hashed, so a version bump elsewhere in
// the same PR (#3612) is not read as an output change. Fixtures are seeded, so the recording is stable.
//
// Re-recorded once, for `bodyBattery` only (#3658): the response's `charged`/`drained` now report
// only what reached the level. Before re-recording, the same cases were hashed with the old figures
// (the stored gross totals) put back in, and every one matched the recording from `main`, so the
// level, the stored row, stress and availability did not move.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { ACTIVITY_MODEL_VERSION } from '@trainingai/shared/health/activity-score'
import { SLEEP_SCORE_MODEL_VERSION } from '@trainingai/shared/health/sleep-score'
import type { WorkoutRepository } from '@/lib/data/repository'
import { resolveReadinessNightInputs, type NightInputSources } from '@/lib/health/readiness-night-inputs'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

const h = vi.hoisted(() => ({ series: false }))
let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/health/daytime-stress', async (orig) => ({
  ...(await orig<typeof import('@/lib/health/daytime-stress')>()),
  // A dHRV series on demand, so both sides of the stress-drain fallback are recorded.
  buildDaytimeStressSeriesFromModel: (_t: unknown, _m: unknown, _hr: unknown, _model: unknown, _b: unknown, wake: number) =>
    h.series ? Array.from({ length: 6 }, (_, i) => ({ t: wake + i * 1_800_000, stressLevel: i % 2 === 0 ? -0.4 : 0.2, dhrv: 40 + i })) : [],
}))

import { computeBodyBatteryDay, BODY_BATTERY_MODEL_VERSION } from '@/lib/health/body-battery-day'
import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const EXPECTED_PATH = join(__dirname, 'fixtures', 'no-change-3613-3616.json')
const RECORD = process.env.RECORD_3613 === '1'
const recorded: Record<string, unknown> = {}

/** Model version strings out, so a bump is never an output change (#3617 had to re-record for one). */
function unversioned(value: unknown): unknown {
  let text = JSON.stringify(value) ?? 'null'
  for (const [v, tag] of [
    [BODY_BATTERY_MODEL_VERSION, '<body-battery-model-version>'],
    [READINESS_MODEL_VERSION, '<readiness-model-version>'],
    [ACTIVITY_MODEL_VERSION, '<activity-model-version>'],
    [SLEEP_SCORE_MODEL_VERSION, '<sleep-score-model-version>'],
  ] as const) text = text.split(v).join(tag)
  return JSON.parse(text)
}
/** Compare against the copy recorded on `main`. */
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
  if (RECORD) writeFileSync(join(tmpdir(), 'no-change-3613-3616.json'), JSON.stringify(recorded, null, 1) + '\n')
})

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// ── #3613: the per-night inputs' version lookup ────────────────────────────────────────────────

const SOURCES = ['source_a', 'source_b', null] as const
const VERSIONS = ['1.0', '2.0', null] as const

/** 40 days of generic rows with mixed sources and versions; one canonical night per date. */
function nightSources(seed: number, today: string, opts: { versionSplit: boolean; mixedSources: boolean }): NightInputSources {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const bodyMetrics: NightInputSources['bodyMetrics'][number][] = []
  const nights: NightInputSources['nights'][number][] = []
  for (let back = 39; back >= 0; back--) {
    const date = shiftDateStr(today, -back)
    const nightSource = opts.mixedSources ? pick(SOURCES) : 'source_a'
    const version = opts.versionSplit ? (back > 18 ? '1.0' : '2.0') : pick(VERSIONS)
    if (r() < 0.9) {
      nights.push({
        date, durationHours: 6 + r() * 2.5, respiratoryRate: 13 + r() * 2,
        durationSource: nightSource, respiratoryRateSource: r() < 0.8 ? nightSource : pick(SOURCES),
        sourceAlgorithmVersion: r() < 0.85 ? version : null,
        recordingIncomplete: r() < 0.05,
      })
    }
    if (r() < 0.92) {
      const metricSource = r() < 0.75 ? nightSource : pick(SOURCES)
      bodyMetrics.push({
        date, hrvMs: r() < 0.95 ? 40 + Math.round(r() * 30) : null, restingHeartRate: 50 + Math.round(r() * 12),
        hrvSource: metricSource, restingHeartRateSource: r() < 0.85 ? metricSource : pick(SOURCES),
        hrvMethod: r() < 0.5 ? 'series_median' : null,
      })
    }
  }
  return { today, summaries: [], bodyMetrics, nights, temperatureDeviations: [], recoveryContributors: [], recoveryHours: [] }
}

describe('readiness night inputs keep their result through the shared version lookup (#3613)', () => {
  it('every generic input, over mixed sources and versions', () => {
    const out: Record<string, unknown> = {}
    let seed = 11
    for (const today of ['2026-10-24', '2026-11-04', '2026-07-08']) {
      for (const versionSplit of [false, true]) {
        for (const mixedSources of [false, true]) {
          for (let k = 0; k < 6; k++) {
            out[`${today} split=${versionSplit} mixed=${mixedSources} #${k}`] =
              resolveReadinessNightInputs(nightSources(seed++ * 131, today, { versionSplit, mixedSources }))
          }
        }
      }
    }
    check('nightInputs', out)
  })
})

// ── #3616: Body Battery's stress drain ─────────────────────────────────────────────────────────

const TZ = 'Australia/Brisbane'
const BB_DATE = '2026-10-18'
const T0 = new Date('2026-10-17T21:00:00Z') // 07:00 Brisbane on BB_DATE

function bodyBatteryRepo(opts: { switchDay: string | null; ouraDaily: Record<string, unknown> | null }) {
  const hr = Array.from({ length: 60 }, (_, i) => ({ timestamp: new Date(T0.getTime() + i * 600_000), bpm: 60 + (i % 7) * 4 }))
  const metrics = Array.from({ length: 12 }, (_, i) => ({
    date: shiftDateStr(BB_DATE, -i), restingHeartRate: 55 + (i % 4), hrvMs: 50 + (i % 5) * 2,
    restingHeartRateSource: 'source_a', hrvSource: 'source_a',
  }))
  const methods: Record<string, unknown> = {
    getOuraDaily: async () => (opts.ouraDaily ? [{ date: BB_DATE, ...opts.ouraDaily }] : []),
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => metrics,
    listSleepSessions: async () => [],
    getHrForWindow: async () => hr,
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => opts.switchDay,
    // A reading from the waking day, so the dHRV series can be built when the mock offers one.
    getOuraDaytimeSignals: async () => ({ temp: [{ tsMs: T0.getTime() + 3_600_000, valueC: 33.4 }], met: [] }),
    getBodyBatteryHistory: async () => [],
    getDaytimeHrvModel: async () => ({ fitted: true }),
  }
  return methods as unknown as WorkoutRepository
}

describe('Body Battery\'s stress drain reads the same minutes through the generic shape (#3616)', () => {
  it('the drain, the stress summary, availability and the stored row', async () => {
    const out: Record<string, unknown> = {}
    const stressValues: (number | null | 'no-row')[] = ['no-row', null, 0, 59, 3_600, 3_617, 7_237, 100_000, -60]
    for (const switchDay of ['2026-10-17', BB_DATE, '2026-10-19', null]) {
      for (const stressHigh of stressValues) {
        for (const series of [false, true]) {
          for (const until of [new Date('2026-10-18T07:00:00Z'), T0]) {
            h.series = series
            const { response, snapshot, hadPersistedAnchor } = await computeBodyBatteryDay({
              repo: bodyBatteryRepo({ switchDay, ouraDaily: stressHigh === 'no-row' ? null : { stressHigh, recoveryHigh: 1_234 } }),
              userId: 'u', tz: TZ, date: BB_DATE, until, computeReadinessIfMissing: false,
            })
            out[`switch=${switchDay} stress=${stressHigh} series=${series} until=${until.toISOString()}`] = {
              all: digest(response),
              current: response.current,
              stress: response.stress,
              availability: response.availability,
              snapshot: digest(snapshot),
              hadPersistedAnchor,
            }
          }
        }
      }
    }
    h.series = false
    check('bodyBattery', out)
  })
})

// ── #3616: the readiness payload's stress and recovery display ─────────────────────────────────

describe('the readiness payload shows the same stress and recovery through the generic shapes (#3616)', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })

  it('stress, recovery, daytime-stress availability and the bedtime window', async () => {
    const out: Record<string, unknown> = {}
    // Either side of the re-key date (2026-07-07) and of a 17 Oct switch day.
    const todays = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-10-16', '2026-10-17', '2026-10-24']
    const todayRows: (Record<string, unknown> | null)[] = [
      null,
      { stressHigh: null, recoveryHigh: null },
      { stressHigh: 0, recoveryHigh: 0 },
      { stressHigh: 3_617, recoveryHigh: 1_201, recommendedBedtimeStart: 'PT22H', recommendedBedtimeEnd: 'PT23H' },
      { stressHigh: 7_200, recoveryHigh: null },
    ]
    for (const today of todays) {
      vi.setSystemTime(new Date(`${today}T05:00:00Z`))
      for (const switchDay of ['2026-10-17', '2026-07-01', null]) {
        for (const [i, row] of todayRows.entries()) {
          for (const derivedStress of [false, true]) {
            const fx = monthFixture(today, TZ)
            if (derivedStress) fx.derived.push({ day: today, stressHighMinutes: 47, recoveryHighMinutes: 13 })
            // Yesterday's row too, so a "today" lookup can't be satisfied by the wrong day.
            const ouraRows = [
              { date: shiftDateStr(today, -1), stressHigh: 999, recoveryHigh: 888, nonWearTimeSec: 100 },
              ...(row ? [{ date: today, nonWearTimeSec: 200, ...row }] : []),
            ]
            repo = {
              ...fixtureRepo(fx),
              getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => ouraRows.filter(r => r.date >= from && r.date <= to)),
              getOuraCloudSwitchDay: vi.fn(async () => switchDay),
            }
            const p = await buildReadinessPayload('u1', TZ)
            out[`${today} switch=${switchDay} row=${i} derived=${derivedStress}`] = {
              stressHigh: p.stressHigh,
              recoveryHigh: p.recoveryHigh,
              daytimeStress: p.availability?.find(a => a.metric === 'daytimeStress') ?? null,
              recommendedBedtimeStart: p.recommendedBedtimeStart,
              recommendedBedtimeEnd: p.recommendedBedtimeEnd,
            }
          }
        }
      }
    }
    check('payload', out)
  })
})
