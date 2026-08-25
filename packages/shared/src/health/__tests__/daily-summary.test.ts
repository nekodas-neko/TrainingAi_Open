import { describe, it, expect } from 'vitest'
import { computeDailySummaries, type NightInput } from '../daily-summary'

function night(date: string, overrides: Partial<NightInput> = {}): NightInput {
  return {
    date,
    sleepDurationHours: 7.5,
    sleepEfficiency: 90,
    deepSleepHours: 1.5,
    remSleepHours: 1.8,
    restlessPeriods: 5,
    sleepLatencySec: 600,
    hrvAvgMs: 45,
    rhrLowBpm: 55,
    rhrAvgBpm: 60,
    recoveryIndexHours: 2,
    tempMeanC: 34.5,
    metAvg: 1.2,
    breathAvgRpm: 14.5,
    ...overrides,
  }
}

describe('computeDailySummaries', () => {
  it('accrues n_history sequentially, starting at 1 for the first night', () => {
    const rows = computeDailySummaries([night('2026-07-01'), night('2026-07-02'), night('2026-07-03')])
    expect(rows.map(r => r.nHistory)).toEqual([1, 2, 3])
  })

  it('has no temperature deviation on the first night (no baseline yet)', () => {
    const rows = computeDailySummaries([night('2026-07-01')])
    expect(rows[0].tempDevC).toBeNull()
    expect(rows[0].tempBaseline).not.toBeNull() // seeded for the next night
  })

  // Q-6: the ported baseline starts from meanX8 = 0, so a deviation taken against it while it is
  // still climbing is nonsense — production held +17.000 degC on the second night, and that number
  // reached the AI prompt and the day-log surface verbatim.
  it('suppresses the temperature deviation while the baseline is still cold', () => {
    const nights = Array.from({ length: 13 }, (_, i) =>
      night(`2026-07-${String(i + 1).padStart(2, '0')}`, { tempMeanC: 35.5 }))
    // Night 1 is 34.5 so the baseline starts well below the rest — the exact shape that produced
    // the +17 degC reading.
    nights[0] = night('2026-07-01', { tempMeanC: 34.5 })
    const rows = computeDailySummaries(nights)
    for (const r of rows) {
      expect(r.nHistory).toBeLessThan(14)
      expect(r.tempDevC).toBeNull()
    }
    // The baseline itself still folds — only the derived deviation is withheld.
    expect(rows.at(-1)!.tempBaseline).not.toBeNull()
  })

  it('reports a temperature deviation once the baseline is mature', () => {
    const nights = Array.from({ length: 15 }, (_, i) =>
      night(`2026-07-${String(i + 1).padStart(2, '0')}`, { tempMeanC: 34.5 }))
    nights[14] = night('2026-07-15', { tempMeanC: 35.5 }) // a full 1.0 degC spike on a mature baseline
    const rows = computeDailySummaries(nights)
    expect(rows[13].nHistory).toBe(14)
    expect(rows[13].tempDevC).not.toBeNull()
    expect(rows[14].tempDevC!).toBeGreaterThan(0) // warmer than the settled baseline
  })

  it('skips baseline updates for nights with a null metric, but still advances n_history', () => {
    const rows = computeDailySummaries([
      night('2026-07-01'),
      night('2026-07-02', { hrvAvgMs: null }),
      night('2026-07-03'),
    ])
    expect(rows[1].hrvBaseline).toEqual(rows[0].hrvBaseline) // unchanged — no sample that night
    expect(rows[2].nHistory).toBe(3)
  })

  it('carries baselines forward independently per metric', () => {
    // Night 2 differs on every metric. It used to reuse night 1's values and still pass, because
    // the old cold start meant the mean was climbing from zero and moved on ANY second sample —
    // so the test could not tell "carried forward and updated" from "still converging" (BF-13).
    // With the first sample seeding exactly, an identical second night correctly moves nothing,
    // which is what made this assertion fail and why the fixture now varies.
    const rows = computeDailySummaries([
      night('2026-07-01'),
      night('2026-07-02', { hrvAvgMs: 61, rhrLowBpm: 48, sleepDurationHours: 6.2, metAvg: 1.9 }),
    ])
    expect(rows[1].hrvBaseline).not.toEqual(rows[0].hrvBaseline)
    expect(rows[1].rhrBaseline).not.toEqual(rows[0].rhrBaseline)
    expect(rows[1].sleepBaseline).not.toEqual(rows[0].sleepBaseline)
    expect(rows[1].metBaseline).not.toEqual(rows[0].metBaseline)
  })

  it('SEEDS each metric on its first sample rather than annealing from zero (BF-13)', () => {
    // The defect in one assertion. `updateBaseline` — the faithful ecore port — starts from
    // meanX8 = 0, so the first sample landed the mean at half the reading and the step size had
    // collapsed to 1/32 long before it caught up. On the owner's temperature history that left the
    // baseline 0.363 °C low at night FIFTY, which is 2.8 nightly sd, and four consumers read it.
    const rows = computeDailySummaries([night('2026-07-01', { hrvAvgMs: 60, rhrLowBpm: 50 })])
    expect(rows[0].hrvBaseline).toEqual({ meanX8: 60 * 8, devX8: 0 })
    expect(rows[0].rhrBaseline).toEqual({ meanX8: 50 * 8, devX8: 0 })
  })

  it('accrues a breathing baseline from breathAvgRpm in rpm×10 sample units', () => {
    const rows = computeDailySummaries([night('2026-07-01'), night('2026-07-02', { breathAvgRpm: 15.0 })])
    // First-ever sample SEEDS: 14.5 rpm → integer sample 145 → meanX8 1160, dev 0.
    // Deterministic — pins the ×10 units.
    //
    // This asserted `{ meanX8: 580, devX8: 73 }` until BF-13, and 580 is exactly half of 1160:
    // the old fold annealed toward the first sample from zero instead of seeding on it, so night 1
    // reported 7.25 rpm for a 14.5 rpm reading. The test was pinning the bug rather than the units.
    expect(rows[0].breathBaseline).toEqual({ meanX8: 1160, devX8: 0 })
    expect(rows[1].breathBaseline).not.toEqual(rows[0].breathBaseline)
  })

  it('skips the breathing baseline on a null-breath night, but still advances n_history', () => {
    const rows = computeDailySummaries([
      night('2026-07-01'),
      night('2026-07-02', { breathAvgRpm: null }),
      night('2026-07-03'),
    ])
    expect(rows[1].breathBaseline).toEqual(rows[0].breathBaseline) // unchanged — no sample that night
    expect(rows[2].nHistory).toBe(3)
  })
})

describe('computeDailySummaries — incremental seed (windowed rollup, C-1)', () => {
  // The keystone correctness guarantee for the bounded rollup: seeding the fold from the persisted
  // checkpoint (the summary row for the night before the window) and folding only the windowed
  // nights must produce BYTE-IDENTICAL rows to a full-history replay. Varied inputs (nulls, spikes)
  // exercise every baseline path; if this holds, windowing cannot drift the readiness baselines.
  const full = [
    night('2026-06-01'),
    night('2026-06-02', { hrvAvgMs: 52, tempMeanC: 35.1 }),
    night('2026-06-03', { rhrLowBpm: null }),
    night('2026-06-04', { breathAvgRpm: null, metAvg: 1.9 }),
    night('2026-06-05', { hrvAvgMs: 38, sleepDurationHours: 6.1 }),
    night('2026-06-06'),
    night('2026-06-07', { tempMeanC: null }),
    night('2026-06-08', { hrvAvgMs: 61, rhrLowBpm: 49 }),
    night('2026-06-09'),
    night('2026-06-10', { metAvg: null }),
  ]

  it('produces identical rows for the windowed tail as a full replay, for every split point', () => {
    const fullRows = computeDailySummaries(full)
    for (let k = 1; k < full.length; k++) {
      const prev = fullRows[k - 1]
      const seed = {
        hrvBaseline: prev.hrvBaseline, rhrBaseline: prev.rhrBaseline, tempBaseline: prev.tempBaseline,
        sleepBaseline: prev.sleepBaseline, metBaseline: prev.metBaseline, breathBaseline: prev.breathBaseline,
        nHistory: prev.nHistory,
      }
      const seededTail = computeDailySummaries(full.slice(k), seed)
      expect(seededTail).toEqual(fullRows.slice(k))
    }
  })

  it('with no seed replays from cold start (the full-history / new-user path is unchanged)', () => {
    expect(computeDailySummaries(full, null)).toEqual(computeDailySummaries(full))
  })
})
