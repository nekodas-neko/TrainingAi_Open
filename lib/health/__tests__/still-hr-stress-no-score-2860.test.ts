/**
 * #2860 F1 step 1 — **no score reads the re-based daytime stress series.** The owner approved the series
 * for the screen only; feeding Body Battery's stress drain is step 2, a separate sign-off.
 *
 * Two pins:
 *  1. **Behaviour.** With the series' inputs present (heart rate, movement, a still-time normal) Body
 *     Battery and readiness give exactly the same output whether the series function returns its real
 *     series or nothing, and neither calls it.
 *  2. **Imports.** Only the stress-day reader and its route import the series; no score module does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import type { MovementIntervalSeries } from '@trainingai/shared/health/per-minute-movement'

const h = vi.hoisted(() => ({ mode: 'real' as 'real' | 'empty', calls: 0 }))

vi.mock('@trainingai/shared/health/still-hr-stress', async (orig) => {
  const real = await orig<typeof import('@trainingai/shared/health/still-hr-stress')>()
  return {
    ...real,
    stillHrStressSeries: (...args: Parameters<typeof real.stillHrStressSeries>) => {
      h.calls++
      return h.mode === 'real' ? real.stillHrStressSeries(...args) : []
    },
  }
})
vi.mock('@/lib/oura-models/constants-inject', () => ({ tryEnsureServerOuraConstants: () => {} }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
let fixture: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => fixture, getRepositoryAsync: async () => fixture }))

import { computeBodyBatteryDay } from '../body-battery-day'
import { buildReadinessPayload } from '../readiness-payload'
import { readStressDay } from '../stress-day'
import type { WorkoutRepository } from '@/lib/data/repository'
import { fixtureRepo, monthFixture } from './fixtures/activity-day-fixtures'

const TZ = 'Australia/Brisbane'
const DATE = '2026-10-21'
const SWITCH = '2026-10-17'
const dayMs = dateStrMidnightInTz(DATE, TZ).getTime()
const at = (hh: number, mm = 0) => dayMs + (hh * 60 + mm) * 60_000
const until = new Date(at(17))

/** Everything the re-based series needs: heart rate every 2 minutes with a raised hour, a still day, a normal. */
function seriesInputs() {
  const hr: { timestamp: Date; bpm: number; source: string | null }[] = []
  for (let t = at(7); t < at(17); t += 120_000) hr.push({ timestamp: new Date(t + 30_000), bpm: t >= at(14) && t < at(15) ? 74 : 61, source: 'oura_cloud' })
  const movement: MovementIntervalSeries[] = [{
    source: 'oura_cloud', startMs: dayMs, intervalMs: 60_000, notWorn: [],
    mets: Array.from({ length: 24 * 60 }, (_, i) => (i >= 12 * 60 && i < 12 * 60 + 40 ? 3.5 : 1.1)),
  }]
  const derived = Array.from({ length: 10 }, (_, i) => ({ day: shiftDateStr(DATE, -(i + 1)), stillRhrBpm: 60, stillRhrCoverageMin: 300 }))
  return { hr, movement, derived }
}

function bodyBatteryRepo() {
  const { hr, movement, derived } = seriesInputs()
  return {
    getOuraDaily: async () => [{ date: DATE, stressHigh: 2_400 }],
    getOuraDailyDerived: async (_u: string, from: string, to: string) => derived.filter(r => r.day >= from && r.day <= to),
    listBodyMetrics: async () => [{ date: DATE, restingHeartRate: 58, hrvMs: 55 }],
    listSleepSessions: async () => [],
    getHrForWindow: async (_u: string, from: Date, to: Date) => hr.filter(x => x.timestamp >= from && x.timestamp < to),
    getPerMinuteMovementSeries: async () => movement,
    getOuraDaytimeStressBuckets: async () => [],
    getUserById: async () => null,
    getOuraCloudSwitchDay: async () => SWITCH,
    getOuraDaytimeSignals: async () => ({ temp: [], met: [] }),
    getBodyBatteryHistory: async () => [],
    getDaytimeHrvModel: async () => ({ fitted: true }),
    listCompletedSessionsOverlapping: async () => [],
    listActivityLogs: async () => [],
  } as unknown as WorkoutRepository
}

async function bodyBattery() {
  const { response, snapshot } = await computeBodyBatteryDay({
    repo: bodyBatteryRepo(), userId: 'u', tz: TZ, date: DATE, until, computeReadinessIfMissing: false,
  })
  return JSON.parse(JSON.stringify({ response, snapshot }))
}

async function readiness() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(until)
  try {
    const fx = monthFixture(DATE, TZ)
    const { hr, derived } = seriesInputs()
    fx.hr = [...fx.hr.filter(x => x.timestamp.getTime() < dayMs), ...hr]
    fx.derived.push(...derived)
    fixture = { ...fixtureRepo(fx), getOuraCloudSwitchDay: async () => SWITCH, getOuraDaytimeStressBuckets: async () => [] }
    const p = await buildReadinessPayload('u', TZ, SWITCH)
    return JSON.parse(JSON.stringify(p))
  } finally {
    vi.useRealTimers()
  }
}

beforeEach(() => { h.calls = 0; h.mode = 'real' })

describe('no score reads the re-based daytime stress series (#2860 F1 step 1)', () => {
  it('the series is really there for this fixture (so the comparisons below mean something)', async () => {
    const s = await readStressDay(bodyBatteryRepo(), 'u', DATE, TZ, until)
    expect(s.method).toBe('still_hr')
    expect(s.series.some(p => p.level < 0)).toBe(true)
  })

  it('Body Battery is identical with the series and without it, and never asks for it', async () => {
    h.mode = 'real'
    const withSeries = await bodyBattery()
    h.mode = 'empty'
    const without = await bodyBattery()
    expect(withSeries).toEqual(without)
    expect(h.calls).toBe(0)
    // Its stress drain still comes from the source's high-stress minutes (the `DaytimeHighStress` fallback).
    expect(withSeries.response.stress).toMatchObject({ series: [], highMinutes: 40 })
  })

  it('readiness is identical with the series and without it, and never asks for it', async () => {
    h.mode = 'real'
    const withSeries = await readiness()
    h.mode = 'empty'
    const without = await readiness()
    expect(withSeries).toEqual(without)
    expect(h.calls).toBe(0)
  })

  it('only the stress-day reader and its route import the series', () => {
    const REPO = join(__dirname, '..', '..', '..')
    const ROOTS = ['app', 'components', 'lib', 'packages/shared/src', 'mobile/src']
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === '__tests__' || n === '__check_fixture__') continue
        const f = join(d, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (/\.(ts|tsx)$/.test(n)) files.push(f.slice(REPO.length + 1))
      }
    }
    ROOTS.forEach(r => walk(join(REPO, r)))
    expect(files.length).toBeGreaterThan(1000)
    // Any way of pulling a module in: `from '…'`, a dynamic `import('…')` or `require('…')`, by alias or
    // by relative path. Each specifier is resolved to a repo path, because `components/body-battery/`
    // has a `stress-day` of its own (the chart's segment maths) that is not the reader.
    const SPEC = /(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g
    const resolved = (file: string, spec: string) =>
      spec.startsWith('@/') ? spec.slice(2)
        : spec.startsWith('@trainingai/shared/') ? `packages/shared/src/${spec.slice('@trainingai/shared/'.length)}`
          : spec.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), spec))
            : spec
    const importers = (target: string) => files.filter(f =>
      [...readFileSync(join(REPO, f), 'utf8').matchAll(SPEC)].some(m => resolved(f, m[1]) === target)).sort()
    expect(importers('packages/shared/src/health/still-hr-stress')).toEqual(['lib/health/stress-day.ts'])
    expect(importers('lib/health/stress-day')).toEqual(['app/api/body-battery/stress-day/route.ts'])
    // The resolver itself: a relative import from beside the reader would be caught.
    expect(resolved('lib/health/body-battery-day.ts', './stress-day')).toBe('lib/health/stress-day')
    expect(resolved('components/body-battery/stress-at-events.ts', './stress-day')).toBe('components/body-battery/stress-day')
  })
})
