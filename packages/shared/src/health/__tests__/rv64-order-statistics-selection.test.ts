import { describe, it, expect } from 'vitest'
import { computeObservedHr, CORROBORATION, PLAUSIBLE_MIN_BPM, PLAUSIBLE_MAX_BPM } from '../observed-hr'

// RV-64. `computeObservedHr` needs three numbers — the k-th highest, the k-th lowest and the mean —
// and used to get the first two by sorting the entire series descending. It now keeps two k-element
// windows in one pass. These tests exist to pin that the two agree, because the existing suite works
// on hand-written series of a dozen readings where a full sort and a selection cannot disagree.

/** What the function used to do, kept here as the oracle the selection must match. */
function referenceBySort(bpms: readonly number[], k = CORROBORATION) {
  const plausible = bpms.filter(b => Number.isFinite(b) && b >= PLAUSIBLE_MIN_BPM && b <= PLAUSIBLE_MAX_BPM)
  if (plausible.length < k) return null
  const desc = [...plausible].sort((a, b) => b - a)
  return { max: desc[k - 1], min: desc[desc.length - k], highestPlausible: desc[0] }
}

/** Deterministic PRNG — a fixed seed, so a failure is reproducible rather than a once-a-month flake. */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000
}

describe('computeObservedHr order statistics', () => {
  it('matches a full descending sort across 200 randomised series', () => {
    const rand = lcg(20260921)
    for (let trial = 0; trial < 200; trial++) {
      const n = 5 + Math.floor(rand() * 400)
      // Deliberately spans the plausible band's edges so out-of-band filtering is exercised too.
      const bpms = Array.from({ length: n }, () => 20 + Math.floor(rand() * 220))
      const ref = referenceBySort(bpms)
      const got = computeObservedHr(bpms)
      if (ref === null) continue
      expect({ max: got.max, min: got.min, highestPlausible: got.highestPlausible }).toEqual(ref)
    }
  })

  it('reports the k-th highest and k-th lowest, not the extremes', () => {
    // Five readings at 180 corroborate it; the lone 200 does not and must not become the max.
    // Mirrored at the bottom: five at 50, one stray 40.
    const bpms = [200, 180, 180, 180, 180, 180, 90, 90, 50, 50, 50, 50, 50, 40]
    const got = computeObservedHr(bpms)

    expect(got.max).toBe(180)
    expect(got.min).toBe(50)
    // The uncorroborated extremes are still reported separately — that is the whole point of the
    // gap between `highestPlausible` and `max`.
    expect(got.highestPlausible).toBe(200)
  })

  it('handles a monotonically rising series, where each reading displaces the window', () => {
    // The adversarial shape for a bounded window: every value beats the current threshold, so the
    // insertion path runs on all n readings rather than a handful. Random data never exercises it.
    const rising = Array.from({ length: 500 }, (_, i) => 40 + Math.floor(i * 0.3))
    const got = computeObservedHr(rising)
    expect({ max: got.max, min: got.min, highestPlausible: got.highestPlausible }).toEqual(referenceBySort(rising))
  })

  it('handles a falling series and an all-equal series', () => {
    const falling = Array.from({ length: 500 }, (_, i) => 190 - Math.floor(i * 0.3))
    expect(pick(computeObservedHr(falling))).toEqual(referenceBySort(falling))

    // Every order statistic collapses onto the same value; k-th highest and k-th lowest are equal.
    const flat = Array(50).fill(72)
    const got = computeObservedHr(flat)
    expect({ max: got.max, min: got.min, highestPlausible: got.highestPlausible }).toEqual({ max: 72, min: 72, highestPlausible: 72 })
  })

  it('still refuses a series shorter than the corroboration count', () => {
    const got = computeObservedHr([100, 101, 102, 103])
    expect(got.max).toBeNull()
    expect(got.min).toBeNull()
    expect(got.avg).toBe(102)
    expect(got.sampleCount).toBe(4)
  })
})

function pick(g: ReturnType<typeof computeObservedHr>) {
  return { max: g.max, min: g.min, highestPlausible: g.highestPlausible }
}
