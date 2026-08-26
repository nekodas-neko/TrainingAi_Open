// Q-501 — a stored readiness score could not be re-derived from the inputs stored beside it.
//
// A persisted contributor was `{score, provisional}` and nothing else, so the only way to ask "what
// produced this 58?" was to read today's `oura_daily_summary` and assume it had not been recomputed
// since. It often had: summaries get re-rolled and the derived rows built from them are not
// recomputed in step. Measured against production 2026-08-26 — of 42 rows carrying a Recovery Index
// contributor, **7 match neither the current anchor nor the previous one**, so their score cannot be
// reproduced from any model applied to the stored hours.
//
// Storing the input is the cheaper of the entry's two options and the self-describing one. The
// property that makes it worth anything is the round trip: **a contributor's own input must
// reproduce its own score**. Anything less and the field is decoration.
//
// The other half is the discrimination it buys. A stored score disagreeing with a fresh recompute
// has two causes needing opposite responses — the inputs were rewritten (a data question) or the
// model moved (a calibration question). `rederiveReadinessFromStored` is what separates them.
import { describe, it, expect } from 'vitest'
import {
  computeReadinessComposite,
  rederiveReadinessFromStored,
  READINESS_WEIGHTS,
  READINESS_MODEL,
  BASELINE_MIN_NIGHTS,
  RECOVERY_INDEX_OPTIMAL_HOURS,
  type ReadinessCompositeInputs,
} from '../readiness-composite'

const FULL: ReadinessCompositeInputs = {
  rhrZ: -0.8, hrvZ: 1.1, tempZ: 0.3, sleepBalanceZ: -0.4,
  previousNightScore: 81, prevDayActivityScore: 64, activityBalanceScore: 72,
  checkinScore: 88, nHistory: BASELINE_MIN_NIGHTS + 6, recoveryIndexHours: 3.2,
}

describe('every contributor records the number it was computed from', () => {
  it('records the z-score for the baseline-relative terms, not the raw measurement', () => {
    const c = computeReadinessComposite(FULL).contributors
    expect(c.restingHeartRate.input).toBe(-0.8)
    expect(c.hrvBalance.input).toBe(1.1)
    expect(c.temperature.input).toBe(0.3)
    expect(c.sleepBalance.input).toBe(-0.4)
  })

  it('records the 0-100 value for the pass-through terms', () => {
    const c = computeReadinessComposite(FULL).contributors
    expect(c.previousNight.input).toBe(81)
    expect(c.prevDayActivity.input).toBe(64)
    expect(c.activityBalance.input).toBe(72)
    expect(c.checkin.input).toBe(88)
  })

  it('records raw hours for the recovery index', () => {
    expect(computeReadinessComposite(FULL).contributors.recoveryIndex.input).toBe(3.2)
  })

  // The score is rounded; the record of what produced it must not be. Storing the rounded value
  // re-derives to the same score — so nothing else here would notice — while quietly reporting an
  // input the day never had.
  it('records the input unrounded, even where the score rounds it', () => {
    const c = computeReadinessComposite({
      ...FULL, previousNightScore: 81.6, activityBalanceScore: 72.4,
    }).contributors
    expect(c.previousNight).toEqual({ score: 82, provisional: false, input: 81.6 })
    expect(c.activityBalance).toEqual({ score: 72, provisional: false, input: 72.4 })
  })

  // A cold baseline discards the z and returns a flat 50. Recording the z anyway would make the row
  // look re-derivable when the score was never a function of it.
  it('records null when a contributor fell back to neutral, even though a z existed', () => {
    const cold = computeReadinessComposite({ ...FULL, nHistory: 3 }).contributors
    expect(cold.restingHeartRate).toEqual({ score: 50, provisional: true, input: null })
    expect(cold.hrvBalance.input).toBeNull()
  })

  it('records null when there was no input at all', () => {
    const none = computeReadinessComposite({
      ...FULL, previousNightScore: null, recoveryIndexHours: null, checkinScore: null,
    }).contributors
    expect(none.previousNight.input).toBeNull()
    expect(none.recoveryIndex.input).toBeNull()
    expect(none.checkin.input).toBeNull()
  })
})

// The whole point. If this fails the field is a decoration rather than a record.
describe('a persisted row can be re-derived from itself', () => {
  it('reproduces every contributor score and the composite, with nothing unchecked', () => {
    const result = computeReadinessComposite(FULL)
    const check = rederiveReadinessFromStored(result.contributors)!
    expect(check.drifted).toEqual([])
    expect(check.uncheckable).toEqual([])
    expect(check.score).toBe(result.score)
  })

  it('holds across the range, cold baselines and missing inputs included', () => {
    const cases: ReadinessCompositeInputs[] = [
      FULL,
      { ...FULL, nHistory: 2 },                                   // every z term neutral
      { ...FULL, rhrZ: -3, hrvZ: 4, tempZ: -2.5, sleepBalanceZ: 3 }, // clamped at both ends
      { ...FULL, recoveryIndexHours: RECOVERY_INDEX_OPTIMAL_HOURS * 3 }, // clamped hours
      { ...FULL, previousNightScore: 0, prevDayActivityScore: 100, activityBalanceScore: 0 },
      { rhrZ: null, hrvZ: null, tempZ: null, sleepBalanceZ: null, previousNightScore: null,
        prevDayActivityScore: null, activityBalanceScore: null, nHistory: 0 },  // nothing at all
    ]
    for (const input of cases) {
      const result = computeReadinessComposite(input)
      const check = rederiveReadinessFromStored(result.contributors)!
      expect(check.drifted, JSON.stringify(input)).toEqual([])
      expect(check.score, JSON.stringify(input)).toBe(result.score)
    }
  })

  it('re-derives a fractional hours input without rounding it away', () => {
    // 2.376 h is a real measured value; a field that stored a rounded 2 would re-derive to a
    // different score and this would catch it.
    const result = computeReadinessComposite({ ...FULL, recoveryIndexHours: 2.376 })
    expect(rederiveReadinessFromStored(result.contributors)!.drifted).toEqual([])
  })
})

describe('it tells a model change from an input change', () => {
  // The row Q-501 measured: a stored Recovery Index score that no model applied to the stored hours
  // reproduces. Before the input was stored this was indistinguishable from a rewritten summary.
  it('flags a stored score the current model does not reproduce from its own input', () => {
    const result = computeReadinessComposite(FULL)
    const tampered = {
      ...result.contributors,
      recoveryIndex: { ...result.contributors.recoveryIndex, score: 4 },  // an old model's answer
    }
    const check = rederiveReadinessFromStored(tampered)!
    expect(check.drifted).toEqual([
      { key: 'recoveryIndex', stored: 4, rederived: result.contributors.recoveryIndex.score },
    ])
    // The composite it reports is the CURRENT model's, so it is comparable with a live recompute.
    expect(check.score).toBe(result.score)
  })

  it('reports every drifted contributor, not just the first', () => {
    const c = computeReadinessComposite(FULL).contributors
    const check = rederiveReadinessFromStored({
      ...c,
      hrvBalance: { ...c.hrvBalance, score: 1 },
      checkin: { ...c.checkin, score: 2 },
    })!
    expect(check.drifted.map(d => d.key).sort()).toEqual(['checkin', 'hrvBalance'])
  })

  // An input change leaves the row self-consistent — which is exactly what says "the model is fine,
  // the summary underneath moved".
  it('reports no drift when only the inputs changed', () => {
    const before = computeReadinessComposite({ ...FULL, recoveryIndexHours: 1.2 })
    const after = computeReadinessComposite({ ...FULL, recoveryIndexHours: 5.78 })
    expect(before.score).not.toBe(after.score)
    const check = rederiveReadinessFromStored(before.contributors)!
    expect(check.drifted).toEqual([])
    expect(check.score).toBe(before.score)   // still re-derives to what was stored
  })
})

describe('rows written before the input was persisted', () => {
  const legacy = {
    restingHeartRate: { score: 77, provisional: false },
    hrvBalance: { score: 62, provisional: false },
    temperature: { score: 80, provisional: false },
    sleepBalance: { score: 43, provisional: false },
    previousNight: { score: 78, provisional: false },
    prevDayActivity: { score: 55, provisional: false },
    recoveryIndex: { score: 24, provisional: true },
    activityBalance: { score: 66, provisional: false },
    checkin: { score: 72, provisional: false },
  }

  // Silently counting these as agreeing would be the same false confidence the entry is about.
  it('names them uncheckable rather than passing them', () => {
    const check = rederiveReadinessFromStored(legacy)!
    expect(check.drifted).toEqual([])
    expect(check.uncheckable.sort()).toEqual(Object.keys(READINESS_WEIGHTS).sort())
  })

  it('still reports a composite, using the stored scores it cannot re-derive', () => {
    const expected = Math.round(
      (Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[])
        .reduce((sum, k) => sum + legacy[k].score * READINESS_WEIGHTS[k], 0))
    expect(rederiveReadinessFromStored(legacy)!.score).toBe(expected)
  })

  it('handles a half-migrated row — one term checked, the rest not', () => {
    const c = computeReadinessComposite(FULL).contributors
    const check = rederiveReadinessFromStored({ ...legacy, recoveryIndex: c.recoveryIndex })!
    expect(check.uncheckable).not.toContain('recoveryIndex')
    expect(check.uncheckable).toHaveLength(Object.keys(READINESS_WEIGHTS).length - 1)
  })
})

describe('it refuses to invent a verdict', () => {
  it('is null for anything that is not a contributor map', () => {
    for (const bad of [null, undefined, 'x', 42, [], [{ score: 1 }], {}, { nonsense: 1 }]) {
      expect(rederiveReadinessFromStored(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('is null for the pre-composite Record<string, number> shape', () => {
    // `oura_daily.readiness_contributors` (the frozen Cloud table) is flat numbers, and the two
    // columns are one careless argument apart.
    expect(rederiveReadinessFromStored({ previousNight: 88, hrvBalance: 71 })).toBeNull()
  })

  it('skips a contributor whose stored score is not a finite number', () => {
    const c = computeReadinessComposite(FULL).contributors
    const check = rederiveReadinessFromStored({ ...c, checkin: { score: null, provisional: false } })!
    expect(check.drifted).toEqual([])
    expect(check.uncheckable).toEqual([])
    // checkin carried 0.10 of the weight and is now absent from the sum entirely.
    expect(check.score).toBe(Math.round(
      computeReadinessComposite(FULL).score - c.checkin.score * READINESS_WEIGHTS.checkin))
  })
})

// The model this re-derivation applies must be the one the audit reports, or the verdict is about a
// model nobody can see.
it('re-derives under the same directions the exported model publishes', () => {
  expect(Object.keys(READINESS_MODEL.directions).sort()).toEqual(Object.keys(READINESS_WEIGHTS).sort())
})
