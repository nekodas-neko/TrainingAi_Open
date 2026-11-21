/**
 * #3924 — the unusual-day readiness prompt has stored no verdict in production. This is the local
 * replay the issue asks for: the real `/api/readiness-verdict` route, an in-memory repository, and
 * 120 stored days shaped like production's (v17 rows on the 50-centred scale, v18 rows from the
 * 18 Nov release on the 75-centred scale, and 8 of the last 34 days with no stored score, as #3883
 * counted). Each day from the prompt's ship date (26 Oct, #3354) is asked once, the way Preview's
 * Home card asks on that day.
 *
 * What it shows: on every day with a stored, stamped score and 28 scored days before it, the route
 * freezes a verdict, including the days either side of the re-centring, and unusual days come out
 * at roughly the calibrated rate. So neither the writer nor the trigger's arithmetic is what keeps
 * `readiness_verdicts` empty; the verdict is stored only when Preview's card asks, and the card is
 * on screen only when the "Exercise Readiness" Home card is switched on (see the issue).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { baselineContributorCurve } from '@trainingai/shared/health/readiness-composite'
import { toCurrentReadinessScale } from '@trainingai/shared/health/readiness-scale'

type Row = Record<string, unknown>

const verdicts = new Map<string, Row>()
let stored: Row[] = []

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-replay', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getReadinessVerdict: async (_u: string, d: string) => verdicts.get(d) ?? null,
    upsertReadinessVerdict: async (_u: string, r: Row) => { verdicts.set(r.date as string, r) },
    getOuraDailyDerived: async (_u: string, from: string, to: string) =>
      stored.filter(r => (r.day as string) >= from && (r.day as string) <= to),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
// 27 asks in one test; the route's hourly limit is not what is being replayed.
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { GET } from '@/app/api/readiness-verdict/route'

const V17 = 'v17:activity-one-input:2026-11-04'
const V18 = 'v18:baseline-centre-75:2026-11-15'
const RELEASE = '2026-11-18'
const SHIPPED = '2026-10-26'
const LAST = '2026-11-21'
/** The 8 of 34 days since the Oura Cloud switch that had no stored score (#3883's count). */
const MISSING = new Set(['2026-10-19', '2026-10-24', '2026-10-30', '2026-11-01', '2026-11-08', '2026-11-11', '2026-11-15', '2026-11-16'])

/** A seeded generator, so the replay is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())

/**
 * One stored day. The person's z-scores drive both scales: a v17 row stores the 50-centred
 * sub-scores, and a v18 row stores what the shared converter says that same day reads at 75, so a
 * day reads the same person on either side of the release.
 */
function day(date: string, r: () => number): Row {
  const z = { rhr: normal(r), hrv: normal(r), sleep: normal(r) }
  const old = (v: number) => Math.max(0, Math.min(100, Math.round(50 + 15 * v)))
  const contributors = {
    restingHeartRate: { score: old(-z.rhr), input: z.rhr },
    hrvBalance: { score: old(z.hrv), input: z.hrv },
    sleepBalance: { score: old(z.sleep), input: z.sleep },
  }
  const v17Score = Math.round(62 + 6 * (z.hrv - z.rhr + z.sleep) / 3 + 3 * normal(r))
  if (date < RELEASE) {
    return { day: date, readinessScore: v17Score, readinessContributors: contributors, modelVersions: { readiness: V17 } }
  }
  const v18Contributors = {
    restingHeartRate: { score: Math.round(baselineContributorCurve(z.rhr, 'lower-better')), input: z.rhr },
    hrvBalance: { score: Math.round(baselineContributorCurve(z.hrv, 'higher-better')), input: z.hrv },
    sleepBalance: { score: Math.round(baselineContributorCurve(z.sleep, 'higher-better')), input: z.sleep },
  }
  const v18Score = toCurrentReadinessScale(v17Score, V17, contributors)
  return { day: date, readinessScore: v18Score, readinessContributors: v18Contributors, modelVersions: { readiness: V18 } }
}

function history(seed: number, missing: ReadonlySet<string> = MISSING): Row[] {
  const r = rng(seed)
  const rows: Row[] = []
  for (let i = 120; i >= 0; i--) {
    const date = shiftDateStr(LAST, -i)
    const row = day(date, r)
    if (!missing.has(date)) rows.push(row)
  }
  return rows
}

/** Ask the route about each day from the ship date, with only the rows stored by that day. */
async function replay(all: Row[]) {
  verdicts.clear()
  const asked: { date: string; verdict: string | null }[] = []
  for (let date = SHIPPED; date <= LAST; date = shiftDateStr(date, 1)) {
    stored = all.filter(r => (r.day as string) <= date)
    const res = await GET(new Request(`http://localhost/api/readiness-verdict?date=${date}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { verdict: { verdict: string } | null }
    asked.push({ date, verdict: body.verdict?.verdict ?? null })
  }
  return asked
}

beforeEach(() => {
  verdicts.clear()
  stored = []
})

describe('#3924 replay: the route freezes a verdict on every day it is asked about and can judge', () => {
  it('stores a verdict for every scored day from the ship date, across the 18 Nov re-centring', async () => {
    const all = history(3924)
    const asked = await replay(all)
    const scoredDays = asked.filter(a => !MISSING.has(a.date))
    // Every day with a stored score got a frozen verdict; only the unscored days are silent.
    expect(scoredDays.every(a => a.verdict !== null)).toBe(true)
    expect(asked.filter(a => MISSING.has(a.date)).every(a => a.verdict === null)).toBe(true)
    expect(verdicts.size).toBe(scoredDays.length)
    // The v18 days are judged too: the re-centring left no fixed threshold behind.
    const afterRelease = scoredDays.filter(a => a.date >= RELEASE)
    expect(afterRelease.length).toBe(4)
    expect(afterRelease.every(a => a.verdict !== null)).toBe(true)
  })

  it('does not read the re-centred scores as unusual: the band moved with them', async () => {
    // Over many seeds, a v18 day is "good" about as often as a v17 day. Had the band stayed on the
    // 50-centred baseline (the v3 rule, or no conversion), every v18 day would sit above it.
    let goodAfter = 0, after = 0, unusualBefore = 0, before = 0
    for (let seed = 1; seed <= 40; seed++) {
      const asked = await replay(history(seed, new Set()))
      for (const a of asked) {
        if (a.date >= RELEASE) { after++; if (a.verdict === 'good') goodAfter++ } else { before++; if (a.verdict !== 'normal') unusualBefore++ }
      }
    }
    expect(goodAfter / after).toBeLessThan(0.35)
    // About five unusual days a month is the calibration target (#2430): between 2 and 12 per 30.
    expect((unusualBefore / before) * 30).toBeGreaterThan(2)
    expect((unusualBefore / before) * 30).toBeLessThan(12)
  })

  it('is silent, and stores nothing, while fewer than 28 scored days precede the day', async () => {
    // A history that starts on 1 Oct: the first ask that can be judged is the 29th scored day.
    const all = history(7, new Set()).filter(r => (r.day as string) >= '2026-10-01')
    const asked = await replay(all)
    const firstJudged = asked.find(a => a.verdict !== null)?.date
    expect(firstJudged).toBe('2026-10-29')
    expect([...verdicts.keys()].every(d => d >= '2026-10-29')).toBe(true)
  })
})
