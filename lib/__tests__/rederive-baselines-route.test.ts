/**
 * BF-13 / TN-6 / Q-506 — `admin/rederive-baselines`, the run that clears the three entries'
 * `Keep:` lines.
 *
 * The seed defect itself already shipped fixed (`seedOrUpdateBaseline`, Q-6), and that is exactly
 * why this route exists: `computeDailySummaries` resumes from the previous night's persisted
 * checkpoint, so a fix to the cold-start path never reaches a history that was already folded from
 * zero. The corrupted state is inherited forward nightly, indefinitely. These tests build a stored
 * history with the OLD zero-seed fold (`updateBaseline`, still exported as the vendor port) and
 * assert the route re-derives it.
 *
 * What each case decides:
 *
 *   · **The re-derived baseline is near the true mean and the stored one is not** — the defect,
 *     reproduced rather than asserted about.
 *   · **`dryRun` is the default and writes nothing**, even with changes to make.
 *   · **Only the temperature columns are written.** The owner's 2026-08-24 decision was to fix the
 *     seed for all six metrics and re-derive only the ones measurably wrong — temperature was the
 *     only one out by more than noise. A run that quietly rewrote the other five would be the one
 *     category of mistake that gate exists to prevent, so the surviving five baselines are asserted
 *     identical on every written row.
 *   · **An already-correct history writes NOTHING** — the control. Without it, a route that
 *     unconditionally rewrote every row would pass every other case here.
 *   · **An `nHistory` mismatch is reported, never written** — a gapped history is a different
 *     defect, and repairing it silently inside this one would hide it.
 *
 * Not exercised: no SQL and no device. The repository is a stand-in, so nothing here says the
 * production history has the shape the entry measured — that measurement is in BF-13, taken
 * through the admin read endpoint, and is not re-derived here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateBaseline, type Baseline } from '@trainingai/shared/health/personal-baseline'
import { temperatureDeviationCentiC } from '@trainingai/shared/health/temperature-baseline'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import { TEMP_DEV_FEVER_LIMIT_C } from '@trainingai/shared/health/chronic-stress-assembly'
import type { OuraDailySummaryRow } from '@/lib/data/repository'

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Record<string, unknown> | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const getOuraDailySummary = vi.fn(async (..._a: unknown[]) => [] as OuraDailySummaryRow[])
const upsertOuraDailySummary = vi.fn(async (..._a: unknown[]) => undefined)

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null =
  { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }

vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    getOuraDailySummary: (...a: unknown[]) => getOuraDailySummary(...a),
    upsertOuraDailySummary: (...a: unknown[]) => upsertOuraDailySummary(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST } from '@/app/api/admin/rederive-baselines/route'

const call = (qs = '') =>
  POST(new Request(`http://localhost/api/admin/rederive-baselines${qs}`, { method: 'POST' }))

/** Sentinels for the five baselines this route must not touch. Distinct values so a row that came
 *  back with any of them recomputed fails loudly rather than coincidentally matching. */
const OTHER: Record<'hrv' | 'rhr' | 'sleep' | 'met' | 'breath', Baseline> = {
  hrv:    { meanX8: 111, devX8: 11 },
  rhr:    { meanX8: 222, devX8: 22 },
  sleep:  { meanX8: 333, devX8: 33 },
  met:    { meanX8: 444, devX8: 44 },
  breath: { meanX8: 555, devX8: 55 },
}

const date = (i: number) => `2026-06-${String(i + 1).padStart(2, '0')}`

/** A realistic nightly skin-temperature series: a tight spread around ~35.8 °C, which is what makes
 *  the zero seed visible in this metric and invisible in the other five (BF-13 §2). */
const TEMPS = Array.from({ length: 28 }, (_, i) => 35.8 + [0.02, -0.05, 0.11, -0.03, 0.07, -0.09, 0.0][i % 7])

/**
 * The stored history as the ZERO-SEED fold produced it — `updateBaseline` from null, which starts
 * the mean at 0 and anneals toward the sample. This is the pre-Q-6 behaviour; it no longer exists
 * anywhere in source, so it is reconstructed here rather than imported.
 *
 * `fold` lets a caller substitute the corrected seed to build the control history below.
 */
function storedHistory(
  temps: number[],
  fold: (b: Baseline | null, sample: number, age: number) => Baseline = updateBaseline,
): OuraDailySummaryRow[] {
  let tempBaseline: Baseline | null = null
  return temps.map((tempMeanC, i) => {
    const nHistory = i + 1
    const centi = Math.round(tempMeanC * 100)
    // Deviation is measured against the baseline BEFORE tonight's update, and is null until the
    // baseline is old enough to mean anything — both exactly as `computeDailySummaries` does it.
    const tempDevC = tempBaseline != null && nHistory >= BASELINE_MIN_NIGHTS
      ? temperatureDeviationCentiC(centi, tempBaseline.meanX8 / 8) / 100
      : null
    tempBaseline = fold(tempBaseline, centi, i)
    return {
      date: date(i),
      sleepDurationHours: 8, sleepEfficiency: 90, deepSleepHours: 1.2, remSleepHours: 1.5,
      restlessPeriods: 3, sleepLatencySec: 600, hrvAvgMs: null, rhrLowBpm: null, rhrAvgBpm: null,
      recoveryIndexHours: null, tempMeanC, metAvg: null, breathAvgRpm: null,
      tempDevC,
      hrvBaseline: OTHER.hrv, rhrBaseline: OTHER.rhr, tempBaseline,
      sleepBaseline: OTHER.sleep, metBaseline: OTHER.met, breathBaseline: OTHER.breath,
      nHistory,
    } as OuraDailySummaryRow
  })
}

const body = async (r: Response) => await r.json() as {
  dryRun: boolean
  summary: {
    nightsExamined: number; changed: number; unchanged: number
    latestBaselineC: { stored: number | null; rederived: number | null }
    nHistoryMismatches: { date: string; stored: number; rederived: number }[]
  }
  nights: {
    date: string; action: string
    stored: { baselineC: number | null; tempDevC: number | null }
    rederived: { baselineC: number | null; tempDevC: number | null }
  }[]
}

beforeEach(() => {
  for (const m of [getUserById, rateLimit, getOuraDailySummary, upsertOuraDailySummary]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  getOuraDailySummary.mockResolvedValue(storedHistory(TEMPS))
  sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Australia/Brisbane' }
})

describe('the gate', () => {
  it('401s with no session', async () => {
    sessionUser = null
    expect((await call()).status).toBe(401)
  })

  it('403s for a non-admin, by the DB flag rather than the JWT claim', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    expect((await call()).status).toBe(403)
  })

  it('429s when rate-limited, before reading anything', async () => {
    rateLimit.mockReturnValue(false)
    expect((await call()).status).toBe(429)
    expect(getOuraDailySummary).not.toHaveBeenCalled()
  })

  it('404s rather than writing when there is no history to fold', async () => {
    getOuraDailySummary.mockResolvedValue([])
    expect((await call('?dryRun=false')).status).toBe(404)
    expect(upsertOuraDailySummary).not.toHaveBeenCalled()
  })
})

describe('the defect it undoes', () => {
  it('re-derives a baseline near the true mean where the stored one is still climbing', async () => {
    const res = await body(await call())
    const trueMean = TEMPS.reduce((a, b) => a + b, 0) / TEMPS.length
    const { stored, rederived } = res.summary.latestBaselineC

    // The zero-seed fold is still short after 28 nights; the cold replay is within nightly noise.
    expect(Math.abs(stored! - trueMean)).toBeGreaterThan(0.2)
    expect(Math.abs(rederived! - trueMean)).toBeLessThan(0.05)
    expect(rederived!).toBeGreaterThan(stored!)
  })

  it('seeds the first night from its own sample instead of half of it', async () => {
    const res = await body(await call())
    const first = res.nights[0]
    expect(first.stored.baselineC!).toBeCloseTo(TEMPS[0] / 2, 2)
    expect(first.rederived.baselineC!).toBeCloseTo(TEMPS[0], 2)
  })
})

describe('what it writes', () => {
  it('writes nothing by default, however much it found to change', async () => {
    const res = await body(await call())
    expect(res.dryRun).toBe(true)
    expect(res.summary.changed).toBeGreaterThan(0)
    expect(upsertOuraDailySummary).not.toHaveBeenCalled()
  })

  it('commits only on an explicit dryRun=false, and only the rows that changed', async () => {
    const res = await body(await call('?dryRun=false'))
    expect(res.dryRun).toBe(false)
    expect(upsertOuraDailySummary).toHaveBeenCalledTimes(1)
    const written = upsertOuraDailySummary.mock.calls[0][1] as OuraDailySummaryRow[]
    expect(written).toHaveLength(res.summary.changed)
    expect(written.length).toBeLessThanOrEqual(res.nights.length)
  })

  it('leaves the other five baselines exactly as stored on every written row', async () => {
    await call('?dryRun=false')
    const written = upsertOuraDailySummary.mock.calls[0][1] as OuraDailySummaryRow[]
    expect(written.length).toBeGreaterThan(0)
    for (const r of written) {
      expect(r.hrvBaseline).toEqual(OTHER.hrv)
      expect(r.rhrBaseline).toEqual(OTHER.rhr)
      expect(r.sleepBaseline).toEqual(OTHER.sleep)
      expect(r.metBaseline).toEqual(OTHER.met)
      expect(r.breathBaseline).toEqual(OTHER.breath)
    }
  })

  it('re-derives the deviation too, not just the baseline it is measured from', async () => {
    // `temp_dev_c` is the column the three consumers actually read — the readiness penalty ladder,
    // the illness radar's z, and the deload card. Correcting the baseline while writing back the
    // deviation computed against the OLD one fixes nothing any of them can see, and every other
    // assertion in this file passes while it does.
    const res = await body(await call('?dryRun=false'))
    const written = upsertOuraDailySummary.mock.calls[0][1] as OuraDailySummaryRow[]

    const scored = res.nights.filter(n => n.stored.tempDevC != null && n.action === 'written')
    expect(scored.length).toBeGreaterThan(0)
    for (const n of scored) {
      const row = written.find(w => w.date === n.date)!
      expect(row.tempDevC).toBe(n.rederived.tempDevC)
      expect(row.tempDevC).not.toBe(n.stored.tempDevC)
    }

    // The zero-seed baseline sits below every nightly value, so its deviation reads high-positive on
    // every scored night — BF-13 measured 0 of 34 negative. A re-derived baseline centres it.
    const worstStored = Math.max(...scored.map(n => Math.abs(n.stored.tempDevC!)))
    const worstRederived = Math.max(...scored.map(n => Math.abs(n.rederived.tempDevC!)))
    expect(worstStored).toBeGreaterThan(0.2)
    expect(worstRederived).toBeLessThan(0.2)
  })

  it('carries the nightly values through untouched — the re-derivation changes an intermediate, not a record', async () => {
    const stored = storedHistory(TEMPS)
    await call('?dryRun=false')
    const written = upsertOuraDailySummary.mock.calls[0][1] as OuraDailySummaryRow[]
    for (const r of written) {
      const before = stored.find(s => s.date === r.date)!
      expect(r.tempMeanC).toBe(before.tempMeanC)
      expect(r.sleepDurationHours).toBe(before.sleepDurationHours)
      expect(r.nHistory).toBe(before.nHistory)
    }
  })
})

describe("TN-8's mask premise, asserted here because that entry asked for it here", () => {
  it('turns a permanently-positive deviation into a centred one, below the fever mask', async () => {
    // `TEMP_DEV_FEVER_LIMIT_C` masks a night out of the chronic-stress window on the premise that a
    // healthy night never reaches it. Against a zero-seed baseline the deviation is positive on
    // EVERY night — BF-13 measured 0 of 34 negative — so the mask is reading baseline error, not
    // temperature, and its premise is false as written.
    const res = await body(await call())
    const scored = res.nights.filter(n => n.stored.tempDevC != null)
    expect(scored.length).toBeGreaterThan(0)

    expect(scored.filter(n => n.stored.tempDevC! <= 0)).toEqual([])
    expect(scored.some(n => n.rederived.tempDevC! < 0)).toBe(true)
    expect(scored.filter(n => n.rederived.tempDevC! > TEMP_DEV_FEVER_LIMIT_C)).toEqual([])
  })
})

describe('the control: a history that is already correct', () => {
  // Deliberately equivalent — the same nights, folded with the seed the route itself would apply.
  // Every other case here would also pass against a route that rewrote all 28 rows unconditionally;
  // this is the one that would not.
  const seeded = (b: Baseline | null, sample: number, age: number): Baseline =>
    b == null ? { meanX8: sample << 3, devX8: 0 } : updateBaseline(b, sample, age)

  beforeEach(() => { getOuraDailySummary.mockResolvedValue(storedHistory(TEMPS, seeded)) })

  it('finds nothing to change and writes nothing, even with dryRun=false', async () => {
    const res = await body(await call('?dryRun=false'))
    expect(res.summary.changed).toBe(0)
    expect(res.summary.unchanged).toBe(res.summary.nightsExamined)
    expect(res.nights.every(n => n.action === 'unchanged')).toBe(true)
    expect(upsertOuraDailySummary).not.toHaveBeenCalled()
  })
})

describe('a gapped history', () => {
  it('reports an nHistory mismatch and still writes the stored count, not a repaired one', async () => {
    const rows = storedHistory(TEMPS)
    rows[5] = { ...rows[5], nHistory: 99 }
    getOuraDailySummary.mockResolvedValue(rows)

    const res = await body(await call('?dryRun=false'))
    expect(res.summary.nHistoryMismatches).toEqual([{ date: rows[5].date, stored: 99, rederived: 6 }])

    const written = upsertOuraDailySummary.mock.calls[0][1] as OuraDailySummaryRow[]
    const touched = written.find(r => r.date === rows[5].date)
    expect(touched?.nHistory).toBe(99)
  })
})
