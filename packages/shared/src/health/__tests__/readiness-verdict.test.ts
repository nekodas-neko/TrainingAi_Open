/**
 * #2105 — whether a day's readiness score is unusual, against the scored days before it.
 *
 * The refusals matter most. This feeds a rating prompt, and a verdict built off a thin baseline,
 * or one that lets a day help judge itself, is worse than none: it looks like data.
 */
import { describe, it, expect } from 'vitest'
import {
  readinessVerdictForDay,
  readinessModelVersionOf,
  toReadinessVerdictDays,
  READINESS_VERDICT_BASELINE_DAYS,
  READINESS_VERDICT_IQR_MULTIPLIER,
  READINESS_VERDICT_MODEL_VERSION,
  type ReadinessVerdictDay,
} from '@trainingai/shared/health/readiness-verdict'
import { VERDICT_IQR_MULTIPLIER } from '@trainingai/shared/health/sleep-verdict'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const TARGET = '2026-10-06'
const V6 = 'v6:dev-warmup:2026-10-06'
const V5 = 'v5:no-checkin:2026-10-06'

/** `n` ordinary days ending the day before TARGET, scores 60–66, four of each over 28. Deliberately
 *  not all equal: an IQR of 0 makes the band degenerate, so any deviation would trigger and hide
 *  real bugs. */
function ordinaryDays(n = READINESS_VERDICT_BASELINE_DAYS, modelVersion: string | null = V6): ReadinessVerdictDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: shiftDateStr(TARGET, -(i + 1)),
    score: 60 + (i % 7),
    modelVersion,
  }))
}

// Four each of 60..66: p25 = 61, p75 = 65, median 63 — so 1.0 × IQR gives 57..69.
const ORDINARY_BAND = { median: 63, low: 57, high: 69 }

const day = (over: Partial<ReadinessVerdictDay> = {}): ReadinessVerdictDay => ({
  date: TARGET, score: 63, modelVersion: V6, ...over,
})

describe('the copied calibration', () => {
  it('starts at the sleep multiplier, as #2105 says, under its own version', () => {
    // Copied rather than imported so a later sleep recalibration cannot move this rule silently.
    // Tuning it on the owner's real readiness scores is #2430, and a change there moves
    // READINESS_VERDICT_MODEL_VERSION with it — the rate test over his distribution lands with it.
    expect(READINESS_VERDICT_IQR_MULTIPLIER).toBe(VERDICT_IQR_MULTIPLIER)
    expect(READINESS_VERDICT_IQR_MULTIPLIER).toBe(1.0)
    expect(READINESS_VERDICT_MODEL_VERSION).toBe(1)
    expect(READINESS_VERDICT_BASELINE_DAYS).toBe(28)
  })
})

describe('readinessVerdictForDay', () => {
  it('calls an ordinary day normal and reports the band it used', () => {
    const r = readinessVerdictForDay(day(), ordinaryDays())
    expect(r?.verdict).toBe('normal')
    expect(r?.score).toBe(63)
    expect(r?.baselineDays).toBe(28)
    expect(r?.modelVersion).toBe(READINESS_VERDICT_MODEL_VERSION)
    expect(r?.band).toEqual(ORDINARY_BAND)
  })

  it('calls a low score poor and a high one good', () => {
    expect(readinessVerdictForDay(day({ score: 40 }), ordinaryDays())?.verdict).toBe('poor')
    expect(readinessVerdictForDay(day({ score: 90 }), ordinaryDays())?.verdict).toBe('good')
  })

  it('treats the band edges as inside it', () => {
    expect(readinessVerdictForDay(day({ score: 57 }), ordinaryDays())?.verdict).toBe('normal')
    expect(readinessVerdictForDay(day({ score: 69 }), ordinaryDays())?.verdict).toBe('normal')
    expect(readinessVerdictForDay(day({ score: 56 }), ordinaryDays())?.verdict).toBe('poor')
    expect(readinessVerdictForDay(day({ score: 70 }), ordinaryDays())?.verdict).toBe('good')
  })

  it('says nothing off a thin baseline', () => {
    expect(readinessVerdictForDay(day({ score: 10 }), ordinaryDays(27))).toBeNull()
  })

  it('says nothing when the day has no score', () => {
    expect(readinessVerdictForDay(day({ score: null }), ordinaryDays())).toBeNull()
  })

  it('never lets the day, or a later one, help judge itself', () => {
    // A later outlier and the target's own row are both in `history`; neither may move the band.
    const history = [...ordinaryDays(), day({ score: 5 }), day({ date: shiftDateStr(TARGET, 1), score: 5 })]
    const r = readinessVerdictForDay(day(), history)
    expect(r?.band).toEqual(ORDINARY_BAND)
    expect(r?.baselineDays).toBe(28)
  })

  it('skips days with no stored score rather than counting them', () => {
    // 28 scored days interleaved with 10 unscored ones: still a full window of 28.
    const scored = ordinaryDays(28).map((d, i) => ({ ...d, date: shiftDateStr(TARGET, -(i * 2 + 1)) }))
    const gaps = Array.from({ length: 10 }, (_, i) => ({ date: shiftDateStr(TARGET, -(i * 2 + 2)), score: null, modelVersion: V6 }))
    const r = readinessVerdictForDay(day(), [...scored, ...gaps])
    expect(r?.baselineDays).toBe(28)
  })

  it('uses only the most recent 28 scored days', () => {
    // Older days scored 10 would drag the band down if the window were not capped.
    const old = Array.from({ length: 20 }, (_, i) => ({ date: shiftDateStr(TARGET, -(40 + i)), score: 10, modelVersion: V6 }))
    const r = readinessVerdictForDay(day(), [...ordinaryDays(), ...old])
    expect(r?.band).toEqual(ORDINARY_BAND)
  })

  it('does not care what order history arrives in', () => {
    const shuffled = [...ordinaryDays()].reverse()
    expect(readinessVerdictForDay(day(), shuffled)).toEqual(readinessVerdictForDay(day(), ordinaryDays()))
  })

  it('counts how much of the band came from the same readiness model', () => {
    // v6 landed on 2026-10-06, so a real window today is almost entirely v5. The band still forms;
    // the count is what lets an analysis keep only single-model verdicts.
    const mixed = ordinaryDays().map((d, i) => ({ ...d, modelVersion: i < 3 ? V6 : V5 }))
    const r = readinessVerdictForDay(day(), mixed)
    expect(r?.baselineDays).toBe(28)
    expect(r?.baselineSameVersionDays).toBe(3)

    expect(readinessVerdictForDay(day(), ordinaryDays())?.baselineSameVersionDays).toBe(28)
    // Unstamped rows (before 2026-08-18) are never counted as the same model.
    expect(readinessVerdictForDay(day(), ordinaryDays(28, null))?.baselineSameVersionDays).toBe(0)
    expect(readinessVerdictForDay(day({ modelVersion: null }), ordinaryDays(28, null))?.baselineSameVersionDays).toBe(0)
  })

  it('does not modify the history it is given', () => {
    const history = ordinaryDays()
    const before = JSON.stringify(history)
    readinessVerdictForDay(day({ score: 30 }), history)
    expect(JSON.stringify(history)).toBe(before)
  })
})

describe('reading stored rows', () => {
  it('pulls the readiness stamp out of model_versions, and nothing else', () => {
    expect(readinessModelVersionOf({ readiness: V6, bodyBattery: 'bb2' })).toBe(V6)
    expect(readinessModelVersionOf({ bodyBattery: 'bb2' })).toBeNull()
    expect(readinessModelVersionOf(null)).toBeNull()
    expect(readinessModelVersionOf(['v6'])).toBeNull()
    expect(readinessModelVersionOf({ readiness: 6 })).toBeNull()
    expect(readinessModelVersionOf({ readiness: '' })).toBeNull()
  })

  it('maps derived rows to verdict days', () => {
    expect(toReadinessVerdictDays([
      { day: '2026-10-05', readinessScore: 61, modelVersions: { readiness: V5 } },
      { day: '2026-10-04', readinessScore: null, modelVersions: null },
    ])).toEqual([
      { date: '2026-10-05', score: 61, modelVersion: V5 },
      { date: '2026-10-04', score: null, modelVersion: null },
    ])
  })
})
