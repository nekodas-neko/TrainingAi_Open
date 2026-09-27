import { describe, it, expect, beforeEach } from 'vitest'
import {
  observeResilienceCoverage,
  resilienceGateThresholds,
  setResilienceConstants,
  __clearResilienceConstants,
  type ResilienceConstants,
} from '@/lib/health/stress-resilience'

/**
 * LA-158 — a surface that shows nothing has to be able to say why.
 *
 * Measured in production on 2026-09-27: `resilience_level` had been NULL since 09-22, the rollup
 * was running normally, and the only reason anyone knew was a query against the table. The
 * readiness payload reads a 7-day window, so on that date the tile was still rendering 09-22's
 * level as if it were today's — and would have gone silently blank a few days later.
 *
 * The helper under test is deliberately an OBSERVATION, not a diagnosis: the caller sees fewer
 * days than the model's window, so it must not turn a local shortfall into a cause. These tests
 * pin that distinction, because the tempting "simplification" is to have it return a reason.
 */

// Self-consistent synthetic constants, as the sibling coverage suite uses — the real ones left
// the tree, and every assertion here is relative to whatever gate is injected.
const SYNTH: ResilienceConstants = {
  highWeight: 1, moderateWeight: 0.5, lowWeight: 0.25, neutralWeight: 0.1,
  sleepScoreWeight: 1, hrvBalanceWeight: 1, recoveryIndexWeight: 1, restingHeartRateWeight: 1,
  sleepRecoveryScalerCoef: [0, 1], percentMultiplier: 100,
  moderateToHighCoef: 0.33, lowToModerateCoef: 0.66,
  daytimeRecoveryWeight: 0.5, sleepRecoveryWeight: 0.5,
  todayWeight: 0.5, lastPeriodWeight: 0.5,
  windowLength: 14, windowMinLength: 5,
  planeFitCoef: [1, 1, 0], pcaMinorAxisLength: 1,
  levelMultiplier: [0.2, 0.4, 0.6, 0.8],
  minDaytimeStressHours: 4, resolutionMinutes: 10,
}
const GATE_MIN = SYNTH.minDaytimeStressHours * 60 // 240

/** The real production series for 2026-09-15 → 09-27, in minutes of daytime-stress coverage. */
const PRODUCTION_SEPT = [290, 290, 170, 170, 120, 50, 150, 60, 150, 60, 140, 110, 50]

describe('observeResilienceCoverage — with constants injected', () => {
  beforeEach(() => setResilienceConstants(SYNTH))

  it('counts the days that clear the gate, on the series that actually closed it', () => {
    const o = observeResilienceCoverage(PRODUCTION_SEPT)
    expect(o.daysSeen).toBe(13)
    // Only 09-15 and 09-16 reach 240 of the thirteen.
    expect(o.daysMeetingCoverageGate).toBe(2)
    expect(o.coverageGateMinutes).toBe(GATE_MIN)
    expect(o.minValidDays).toBe(5)
    expect(o.modelWindowDays).toBe(14)
  })

  it('treats the gate as inclusive — a day exactly at the threshold counts', () => {
    // Guards the difference between >= and >, which no production day happens to expose: the
    // series above has nothing at exactly 240, so a mutation to `>` would survive that test.
    expect(observeResilienceCoverage([GATE_MIN]).daysMeetingCoverageGate).toBe(1)
    expect(observeResilienceCoverage([GATE_MIN - 1]).daysMeetingCoverageGate).toBe(0)
  })

  it('counts a missing coverage figure as not meeting the gate, and still as a day seen', () => {
    // NULL is how every pre-2026-09-02 row reads, because the column did not exist yet. Counting
    // it as a pass would invent coverage; dropping it from daysSeen would overstate how much of
    // the window was observed.
    const o = observeResilienceCoverage([null, undefined, 300])
    expect(o.daysSeen).toBe(3)
    expect(o.daysMeetingCoverageGate).toBe(1)
  })

  it('reports an empty window as nothing seen rather than as a shortfall', () => {
    const o = observeResilienceCoverage([])
    expect(o.daysSeen).toBe(0)
    expect(o.daysMeetingCoverageGate).toBe(0)
  })

  it('does not return a reason, cause or verdict — only what was observed', () => {
    // The caller holds 7 days while the model gates on 14, so it cannot establish that coverage
    // is WHY nothing published. If a later change adds a `reason` here, this fails on purpose.
    expect(Object.keys(observeResilienceCoverage([100])).sort()).toEqual([
      'coverageGateMinutes', 'daysMeetingCoverageGate', 'daysSeen', 'minValidDays', 'modelWindowDays',
    ])
  })
})

describe('observeResilienceCoverage — without constants injected', () => {
  beforeEach(() => __clearResilienceConstants())

  it('returns nulls instead of throwing, so the readiness payload still renders', () => {
    // `C_()` throws by design; this path must not, because it runs on a plain request rather than
    // on the rollup where the constants are injected.
    const o = observeResilienceCoverage(PRODUCTION_SEPT)
    expect(o.daysSeen).toBe(13)
    expect(o.daysMeetingCoverageGate).toBeNull()
    expect(o.coverageGateMinutes).toBeNull()
    expect(o.minValidDays).toBeNull()
    expect(o.modelWindowDays).toBeNull()
  })

  it('distinguishes an unknown gate from a gate of zero', () => {
    // A fallback of 0 would make every day "meet" the gate and read as healthy coverage.
    expect(resilienceGateThresholds()).toBeNull()
    expect(observeResilienceCoverage([0, 0]).daysMeetingCoverageGate).not.toBe(2)
  })
})
