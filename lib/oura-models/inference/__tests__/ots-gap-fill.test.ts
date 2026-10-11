// #2115 v4 (owner, 2026-10-06): a minute no `MET/min` route filled is neither zero nor rest. The day is
// not scored when more than 20% of the recency-weighted last 12 hours is empty; under that, the empty
// minutes take one value that leaves the model's weighted mean equal to the measured minutes' mean.
//
// The pure half runs on hand-made constants. The parity half runs the REAL vendored scorer, on a
// coherent hand-made constants set injected through the one accessor both the scorer and the fill
// read (the synthetic CI set cannot produce a score at all), with uneven recency weights and an
// active intensity curve, and checks the fill against it by ratios so the category weight cancels.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/oura-models/constants', () => ({
  getOtsTypedConstants: () => ({
    metIntensityGamma: 2.5, metIntensityM: 2.2, useMetIntensityWeights: true,
    minMetValue: 0.9, highOtsThreshold: 100, minMetsCount: 720,
    metWeights: Float64Array.from({ length: 720 }, (_, j) => 0.2 + (j / 719) ** 2),
    rhrWeights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    vo2maxWeights: [0.9, 1, 1.1, 1.2],
    // One row per sex covering every age, so a vo2max of 45 always has a category.
    vo2maxThresholds: [[0, 0, 120, 30, 40, 50], [1, 0, 120, 30, 40, 50], ...Array.from({ length: 22 }, () => [9, 0, 0, 0, 0, 0])],
    femalePercentiles: [], malePercentiles: [], otherPercentiles: [], femaleAndMaleAgeGroups: [], otherAgeGroups: [],
  }),
}))
import { fillOtsGaps, otsMetFactor, otsFillConstants, MAX_RESIDUAL_SHARE, OTS_WINDOW_MIN, type OtsFillConstants } from '../ots-gap-fill'
import { runTrainingStressScore } from '../ots'

// Recency weights rising across the window, as a real model's would.
const ramp: OtsFillConstants = {
  metWeights: Float64Array.from({ length: OTS_WINDOW_MIN }, (_, j) => 1 + j / 100),
  minMetValue: 0.9, metIntensityGamma: 2, metIntensityM: 3, useMetIntensityWeights: true,
}
const weightedEmptyShare = (mets: (number | null)[], c: OtsFillConstants) => {
  const off = mets.length - OTS_WINDOW_MIN
  let all = 0, empty = 0
  for (let j = 0; j < OTS_WINDOW_MIN; j++) { all += c.metWeights[j]; if (mets[off + j] == null) empty += c.metWeights[j] }
  return empty / all
}
/** Empty the LAST `k` minutes (the heaviest), the shape of evening charging. */
const emptyTail = (n: number, k: number, value = 2): (number | null)[] => Array.from({ length: n }, (_, i) => (i >= n - k ? null : value))

describe('the 20% cap', () => {
  it('scores a day whose recency-weighted empty share is under 20%, and refuses one over it', () => {
    // Find the tail length that straddles the line under the ramp weights.
    let k = 0
    while (weightedEmptyShare(emptyTail(1440, k + 1), ramp) <= MAX_RESIDUAL_SHARE) k++
    const under = fillOtsGaps(emptyTail(1440, k), ramp)
    const over = fillOtsGaps(emptyTail(1440, k + 1), ramp)
    expect(under.status).toBe('ok')
    expect(under.residualShare).toBeLessThanOrEqual(0.2)
    expect(over.status).toBe('insufficient')
    expect(over.residualShare).toBeGreaterThan(0.2)
  })

  it('weights by recency: the same number of empty minutes counts more at the end of the window', () => {
    const early = Array.from({ length: 1440 }, (_, i): number | null => (i >= 720 && i < 870 ? null : 2))
    const late = emptyTail(1440, 150)
    expect(fillOtsGaps(early, ramp).residualShare).toBeLessThan(fillOtsGaps(late, ramp).residualShare)
  })

  it('reads only the last 720 minutes: an empty morning does not count against the day', () => {
    const mets = Array.from({ length: 1440 }, (_, i): number | null => (i < 700 ? null : 2))
    expect(fillOtsGaps(mets, ramp)).toMatchObject({ status: 'ok', residualShare: 0 })
  })

  it('counts a value under the scorer floor as empty, since the scorer would drop it', () => {
    const mets = Array.from({ length: 720 }, (_, i): number | null => (i % 2 ? 0.5 : 2))
    expect(fillOtsGaps(mets, ramp).status).toBe('insufficient')
  })

  it('is insufficient under 720 minutes', () => {
    expect(fillOtsGaps(new Array(719).fill(2), ramp)).toEqual({ status: 'insufficient', residualShare: 1 })
  })
})

describe('the fill', () => {
  it('leaves no null or NaN for the scorer, and keeps every measured minute as it was', () => {
    const mets = Array.from({ length: 900 }, (_, i): number | null => (i % 9 === 0 ? null : 1 + (i % 5)))
    const r = fillOtsGaps(mets, ramp)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.mets.every(Number.isFinite)).toBe(true)
    mets.forEach((v, i) => { if (v != null) expect(r.mets[i]).toBe(v) })
  })

  it('keeps the weighted mean over the window equal to the measured minutes\' mean, with uneven weights', () => {
    const mets = Array.from({ length: 1000 }, (_, i): number | null => (i % 7 === 3 ? null : 1 + ((i * 37) % 11) / 2))
    const r = fillOtsGaps(mets, ramp)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    const off = mets.length - OTS_WINDOW_MIN
    let wf = 0, w = 0, wfMeasured = 0, wMeasured = 0
    for (let j = 0; j < OTS_WINDOW_MIN; j++) {
      const wj = ramp.metWeights[j]
      wf += wj * otsMetFactor(r.mets[off + j], ramp); w += wj
      const v = mets[off + j]
      if (v != null) { wfMeasured += wj * otsMetFactor(v, ramp); wMeasured += wj }
    }
    expect(wf / w).toBeCloseTo(wfMeasured / wMeasured, 6)
  })

  it('never fills below the scorer floor', () => {
    const r = fillOtsGaps(Array.from({ length: 720 }, (_, i): number | null => (i % 10 === 0 ? null : 0.9)), ramp)
    expect(r.status === 'ok' && r.mets.every(v => v >= ramp.minMetValue)).toBe(true)
  })

  it('without the intensity curve the fill is the plain weighted mean', () => {
    const flat = { ...ramp, useMetIntensityWeights: false, metWeights: new Float64Array(OTS_WINDOW_MIN).fill(1) }
    // Odd minutes 2, even minutes 4, and every tenth minute (all even) empty: 360 twos and 288 fours.
    const mets = Array.from({ length: 720 }, (_, i): number | null => (i % 10 === 0 ? null : i % 2 ? 2 : 4))
    const r = fillOtsGaps(mets, flat)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.mets[0]).toBeCloseTo((360 * 2 + 288 * 4) / 648, 6)
  })
})

describe('agrees with the vendored scorer', () => {
  const c = otsFillConstants()
  const score = (mets: number[]) => runTrainingStressScore({
    startTimestampMs: Date.parse('2026-10-05T14:00:00Z'), mets: Float32Array.from(mets),
    age: 33, biologicalSex: 1, rhr: 58, noOts: 0, tzChange: 0, readiness: 70, vo2max: 45,
  })?.ots ?? NaN

  it("restates the scorer's intensity curve: score ratios equal factor ratios", () => {
    // Large METs keep both scores off the scorer's 0.9 clamp, and the category weight cancels.
    const a = score(new Array(720).fill(8)), b = score(new Array(720).fill(12))
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true)
    expect(a / b).toBeCloseTo(otsMetFactor(8, c) / otsMetFactor(12, c), 6)
  })

  it('a filled day scores what the measured minutes alone average to', () => {
    // Every 12th minute empty, measured minutes alternating 8 and 12.
    const mets = Array.from({ length: 900 }, (_, i): number | null => (i % 12 === 5 ? null : i % 2 ? 8 : 12))
    const r = fillOtsGaps(mets, c)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    const off = mets.length - OTS_WINDOW_MIN
    let wf = 0, w = 0
    for (let j = 0; j < OTS_WINDOW_MIN; j++) {
      const v = mets[off + j]
      if (v != null) { wf += c.metWeights[j] * otsMetFactor(v, c); w += c.metWeights[j] }
    }
    const reference = score(new Array(720).fill(12))
    expect(score(r.mets) / reference).toBeCloseTo((wf / w) / otsMetFactor(12, c), 6)
  })
})
