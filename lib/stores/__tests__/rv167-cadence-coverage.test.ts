import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CADENCE_SERIES_BIN_SEC, type CadenceSummary } from '@trainingai/shared/health/cadence'
import { cadenceCoverage, stepsEstimateIfCovered, MIN_CADENCE_COVERAGE } from '../cadence-coverage'

const ROOT = path.resolve(__dirname, '../../..')
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** `bins` ten-second bins, `steps` integrated from them. Values mirror the production shape. */
function summary(bins: number, steps: number | null): CadenceSummary {
  return {
    avgSpm: 116.9,
    series: Array.from({ length: bins }, (_, i) => ({ tSec: i * CADENCE_SERIES_BIN_SEC, spm: 116.9 })),
    source: 'strap',
    readingCount: bins * 10,
    stepsEstimate: steps,
  }
}

/**
 * RV-167 — a walk whose strap accelerometer stream started late stored a fifth of its steps, and
 * nothing flagged it.
 *
 * Measured in production: the 2026-09-04 treadmill walk has 34 bins, the first at tSec 1470 of an
 * 1,800-second walk, and stored 584 steps against 2,888–3,870 for the other nine full-strap walks.
 * `cadence_spm` read a normal 116.9 because the mean is taken over the bins that exist, and
 * body-metadata added the short number on top of ring steps.
 */
describe('RV-167 — coverage is measured against the activity, not the series', () => {
  it('reproduces the production walk: 34 bins of 1,800 s is under a fifth', () => {
    const coverage = cadenceCoverage(summary(34, 584), 1800)
    expect(coverage).toBeCloseTo(34 * 10 / 1800, 5)
    expect(coverage!).toBeLessThan(0.2)
  })

  it('discards that walk’s steps rather than storing a fifth of them', () => {
    expect(stepsEstimateIfCovered(summary(34, 584), 1800)).toBeNull()
  })

  it('keeps a fully covered walk', () => {
    expect(stepsEstimateIfCovered(summary(180, 3400), 1800)).toBe(3400)
  })

  it('caps at 1 — the last bin can run past the end when a walk stops mid-bin', () => {
    // 181 bins is 1,810 s of nominal cover for an 1,800 s walk. Uncapped this reads as 100.6%.
    expect(cadenceCoverage(summary(181, 3400), 1800)).toBe(1)
  })

  it('keeps a walk sitting exactly on the floor, so the threshold is not off by one bin', () => {
    const bins = (MIN_CADENCE_COVERAGE * 1800) / CADENCE_SERIES_BIN_SEC
    expect(stepsEstimateIfCovered(summary(bins, 1700), 1800)).toBe(1700)
    expect(stepsEstimateIfCovered(summary(bins - 1, 1700), 1800)).toBeNull()
  })

  it('returns null coverage — NOT poor coverage — when it cannot be judged', () => {
    // A zero duration would divide by zero, and an empty series has nothing to measure. Neither
    // means "bad", so neither may discard: that would lose good steps on a momentary unknown.
    expect(cadenceCoverage(summary(180, 3400), 0)).toBeNull()
    expect(cadenceCoverage(summary(0, null), 1800)).toBeNull()
    expect(stepsEstimateIfCovered(summary(180, 3400), 0)).toBe(3400)
  })

  it('passes null steps through untouched', () => {
    expect(stepsEstimateIfCovered(summary(180, null), 1800)).toBeNull()
    expect(stepsEstimateIfCovered(null, 1800)).toBeNull()
  })
})

describe('RV-167 — both write paths are guarded, not just the one that was measured', () => {
  it('the guided-walk save uses the elapsed seconds it already derives', () => {
    expect(src('components/guided-walk/walk-summary.tsx'))
      .toMatch(/stepsEstimateIfCovered\(cadence, actualSec\)/)
  })

  it('the manual activity store guards the same integration off the same tracker', () => {
    expect(src('lib/stores/activity-store.ts'))
      .toMatch(/stepsEstimateIfCovered\(cadence, activeMs \/ 1000\)/)
  })

  it('neither site still writes the raw estimate', () => {
    expect(src('components/guided-walk/walk-summary.tsx')).not.toMatch(/cadence\?\.stepsEstimate \?\? null/)
    expect(src('lib/stores/activity-store.ts')).not.toMatch(/cadence\.stepsEstimate \?\? undefined/)
  })
})
