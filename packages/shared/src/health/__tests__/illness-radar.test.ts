import { describe, it, expect } from 'vitest'
import {
  computeIllnessRadar,
  illnessAdvisory,
  illnessFromSummaries,
  latestIllnessFromDerived,
  READINESS_SUPPRESSION,
  type IllnessSummaryInput,
} from '../illness-radar'
import { BASELINE_MIN_NIGHTS } from '../readiness-composite'

const MATURE = BASELINE_MIN_NIGHTS // 14

describe('computeIllnessRadar', () => {
  it('reports "learning" and suppresses nothing on a cold baseline', () => {
    const r = computeIllnessRadar({ tempZ: 3, rhrZ: 3, hrvZ: -3, breathZ: null, nHistory: MATURE - 1 })
    expect(r.flag).toBe('learning')
    expect(r.score).toBe(0)
    expect(r.readinessSuppression).toBe(0)
    // biomarkers still carry the raw z (for the "why") but zero contribution.
    expect(r.biomarkers.temperature?.contribution).toBe(0)
    expect(r.biomarkers.temperature?.z).toBe(3)
  })

  it('returns "normal" with no suppression when biomarkers sit near baseline', () => {
    const r = computeIllnessRadar({ tempZ: 0.5, rhrZ: 0.3, hrvZ: -0.2, breathZ: null, nHistory: MATURE })
    expect(r.flag).toBe('normal')
    expect(r.score).toBeLessThan(40)
    expect(r.readinessSuppression).toBe(0)
  })

  it('ignores healthy-direction moves (temp down, RHR down, HRV up) → score 0', () => {
    const r = computeIllnessRadar({ tempZ: -2, rhrZ: -2, hrvZ: 2, breathZ: null, nHistory: MATURE })
    expect(r.score).toBe(0)
    expect(r.flag).toBe('normal')
  })

  it('flags "watch" for a mild multi-signal deviation, advisory-only', () => {
    const r = computeIllnessRadar({ tempZ: 1, rhrZ: 2, hrvZ: -1.5, breathZ: null, nHistory: MATURE })
    expect(r.flag).toBe('watch')
    expect(r.score).toBeGreaterThanOrEqual(40)
    expect(r.score).toBeLessThan(65)
    expect(r.readinessSuppression).toBe(0)
  })

  it('flags "elevated" (not fever) for a strong non-temp deviation and suppresses readiness', () => {
    const r = computeIllnessRadar({ tempZ: 2, rhrZ: 3, hrvZ: -3, breathZ: null, nHistory: MATURE })
    expect(r.flag).toBe('elevated')
    expect(r.score).toBeGreaterThanOrEqual(65)
    expect(r.readinessSuppression).toBe(READINESS_SUPPRESSION.elevated)
  })

  it('flags "fever" whenever skin-temp z crosses the fever threshold, regardless of composite score', () => {
    const r = computeIllnessRadar({ tempZ: 2.6, rhrZ: 0, hrvZ: 0, breathZ: null, nHistory: MATURE })
    expect(r.flag).toBe('fever')
    expect(r.readinessSuppression).toBe(READINESS_SUPPRESSION.fever)
  })

  it('renormalises weights over the biomarkers actually present', () => {
    // Only temperature present, at full signal → score 100 (weight renormalised to 1).
    const r = computeIllnessRadar({ tempZ: 3, rhrZ: null, hrvZ: null, breathZ: null, nHistory: MATURE })
    expect(r.score).toBe(100)
    expect(r.biomarkers.restingHeartRate).toBeUndefined()
    expect(r.biomarkers.hrvBalance).toBeUndefined()
  })

  it('treats an all-null night as "learning" (nothing to measure)', () => {
    const r = computeIllnessRadar({ tempZ: null, rhrZ: null, hrvZ: null, breathZ: null, nHistory: MATURE })
    expect(r.flag).toBe('learning')
    expect(r.score).toBe(0)
  })

  it('treats elevated breathing as illness-consistent (one-sided, up-bad like RHR)', () => {
    const up = computeIllnessRadar({ tempZ: null, rhrZ: null, hrvZ: null, breathZ: 3, nHistory: MATURE })
    expect(up.score).toBe(100) // sole biomarker → weight renormalised to 1
    expect(up.flag).toBe('elevated')
    const down = computeIllnessRadar({ tempZ: null, rhrZ: null, hrvZ: null, breathZ: -3, nHistory: MATURE })
    expect(down.score).toBe(0) // slower breathing is not an illness signal
  })

  it('gives breathing its 0.25 weighted share when all four biomarkers are present', () => {
    const r = computeIllnessRadar({ tempZ: 0, rhrZ: 0, hrvZ: 0, breathZ: 3, nHistory: MATURE })
    expect(r.score).toBe(25)
    expect(r.biomarkers.breathing?.contribution).toBe(25)
  })
})

describe('illnessFromSummaries', () => {
  // temp baseline 35.00 °C (mean_x8 28000, dev_x8 160 = 0.2 °C); rhr 50 bpm; hrv 60 ms.
  const prior: IllnessSummaryInput = {
    rhrBaseline: { meanX8: 400, devX8: 24 },
    hrvBaseline: { meanX8: 480, devX8: 64 },
    tempBaseline: { meanX8: 28000, devX8: 160 },
    breathBaseline: null,
    rhrLowBpm: 50, hrvAvgMs: 60, tempMeanC: 35.0, breathAvgRpm: null, nHistory: 20,
  }

  it('flags fever when tonight\'s skin temp is +3σ over baseline (mature history)', () => {
    // 35.6 °C → z = (3560 − 3500) / 20 = 3.0 ≥ FEVER_TEMP_Z.
    const current: IllnessSummaryInput = { ...prior, tempMeanC: 35.6, nHistory: 21 }
    const r = illnessFromSummaries(prior, current)
    expect(r.flag).toBe('fever')
    expect(r.readinessSuppression).toBe(READINESS_SUPPRESSION.fever)
    expect(r.biomarkers.temperature?.z).toBe(3)
  })

  it('stays "learning" on the same deviation before the baseline matures', () => {
    const current: IllnessSummaryInput = { ...prior, tempMeanC: 35.6, nHistory: BASELINE_MIN_NIGHTS - 1 }
    expect(illnessFromSummaries(prior, current).flag).toBe('learning')
  })

  it('returns "normal" when tonight sits on baseline', () => {
    const current: IllnessSummaryInput = { ...prior, nHistory: 21 }
    expect(illnessFromSummaries(prior, current).flag).toBe('normal')
  })

  it('derives a breathing z from the prior night\'s baseline, in rpm×10 units', () => {
    // breath baseline: mean_x8 1160 → 145 units (14.5 rpm); dev_x8 40 → 5 units (0.5 rpm).
    const p: IllnessSummaryInput = { ...prior, breathBaseline: { meanX8: 1160, devX8: 40 }, breathAvgRpm: 14.5 }
    const current: IllnessSummaryInput = { ...p, breathAvgRpm: 16.0, nHistory: 21 }
    const r = illnessFromSummaries(p, current)
    expect(r.biomarkers.breathing?.z).toBe(3) // (160 − 145) / 5
  })
})

describe('illnessAdvisory', () => {
  it('returns copy for fever/elevated/watch and null otherwise', () => {
    expect(illnessAdvisory('fever')).toMatch(/temperature/i)
    expect(illnessAdvisory('elevated')).toMatch(/fighting/i)
    expect(illnessAdvisory('watch')).toMatch(/baseline/i)
    expect(illnessAdvisory('normal')).toBeNull()
    expect(illnessAdvisory('learning')).toBeNull()
  })
})

describe('latestIllnessFromDerived', () => {
  const row = (day: string, flag: string | null, score: number | null = 50) =>
    ({ day, illnessFlag: flag, illnessScore: score, illnessBiomarkers: flag ? { temperature: { z: 2.1, contribution: 40 } } : null })

  it('returns the latest row that has a flag (rows arrive sorted asc by day)', () => {
    const r = latestIllnessFromDerived([row('2026-07-14', 'normal'), row('2026-07-15', 'elevated', 70)])
    expect(r).toEqual({
      day: '2026-07-15', flag: 'elevated', score: 70,
      biomarkers: { temperature: { z: 2.1, contribution: 40 } },
    })
  })

  it('skips rows whose illness columns are null (e.g. body-comp-only days)', () => {
    const r = latestIllnessFromDerived([row('2026-07-14', 'watch', 45), row('2026-07-15', null, null)])
    expect(r?.flag).toBe('watch')
    expect(r?.day).toBe('2026-07-14')
  })

  it('returns null while the radar is learning (never fabricate a signal)', () => {
    expect(latestIllnessFromDerived([row('2026-07-15', 'learning', 0)])).toBeNull()
  })

  it('returns null for an empty range and defaults a null score to 0', () => {
    expect(latestIllnessFromDerived([])).toBeNull()
    expect(latestIllnessFromDerived([row('2026-07-15', 'fever', null)])?.score).toBe(0)
  })
})
