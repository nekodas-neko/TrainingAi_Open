// EXTRACTION ORACLE — a frozen copy of the algorithm as it stood INSIDE `aggregateOuraRawSamples`
// before it moved to `night-vitals.ts` (Q-29 / D2 Task 5 groundwork, 2026-08-03).
//
// Why a duplicate implementation lives here, when the repo's rule is one implementation per
// formula: this is the same pattern as the vendored Oura model ports, which stay pinned to a
// captured golden vector. The copy below is not a second production path — nothing imports it —
// it is the evidence that the move changed no numbers.
//
// It earns its place. The DB-backed rollup tests were measured against a deliberate mutation
// (resting HR degraded to a raw per-beat minimum, the exact bug the definition forbids) and
// **passed** — they never covered this path at all. This file and `night-vitals.test.ts` are the
// only things that catch it.
//
// **If you are deliberately changing what these numbers mean, delete this file in the same PR**
// and say so in the notes. A frozen oracle that nobody may change is a trap; one that is knowingly
// retired is a record.

import { describe, it, expect } from 'vitest'
import { medianGated, metActiveWindows, type TimedSample, type ExclusionWindow } from '../daily-medians'
import { metExclusionWindows, rmssdSamples, hrvMsFromSamples, nightlyHeartRate } from '../night-vitals'

// ── The pre-extraction algorithm, copied verbatim out of adapter.ts ───────────────────────────
const numArr = (d: unknown, key: string): number[] => {
  const arr = (d as Record<string, unknown> | null)?.[key]
  return Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number') : []
}
type Row = { ds: number; decoded: unknown }

function oldWay(metRows: Row[], hrvRows: Row[], ibiRows: Row[]) {
  const metActive: TimedSample[] = []
  for (const r of metRows) {
    const mets = numArr(r.decoded, 'met')
    for (let i = 0; i < mets.length; i++) metActive.push({ ds: Number(r.ds) + i * 600, value: mets[i] })
  }
  const metExclusion: ExclusionWindow[] = metActiveWindows(metActive, 600)

  const HRV_PAIR_DS = 5 * 60 * 10
  const rmssd: TimedSample[] = []
  for (const r of hrvRows) {
    const rm = numArr(r.decoded, 'rmssd_ms')
    const hb = numArr(r.decoded, 'hr_bpm')
    for (let i = 0; i < rm.length; i++) {
      if (!(rm[i] > 0)) continue
      const hr = hb[i]
      if (hr != null && (hr < 35 || hr > 150)) continue
      rmssd.push({ ds: Number(r.ds) + i * HRV_PAIR_DS, value: rm[i] })
    }
  }

  const HR_BIN_DS = 5 * 60 * 10
  const hrBins = new Map<number, { sum: number; n: number }>()
  let hrSum = 0, hrN = 0
  for (const r of ibiRows) {
    const bin = Math.floor(Number(r.ds) / HR_BIN_DS)
    const b = hrBins.get(bin) ?? { sum: 0, n: 0 }
    for (const v of numArr(r.decoded, 'hr_bpm')) {
      if (v < 35 || v > 150) continue
      b.sum += v; b.n += 1; hrSum += v; hrN += 1
    }
    hrBins.set(bin, b)
  }
  const binOverlapsMet = (bin: number) => {
    const start = bin * HR_BIN_DS, end = start + HR_BIN_DS
    return metExclusion.some(w => start < w.endDs && end > w.startDs)
  }
  let restingHr: number | null = null
  for (const [bin, b] of hrBins.entries()) {
    if (b.n < 3 || binOverlapsMet(bin)) continue
    const avg = b.sum / b.n
    if (restingHr === null || avg < restingHr) restingHr = avg
  }
  const hrvMedian = medianGated(rmssd, metExclusion)
  const averageHrvMs = hrvMedian != null ? Math.round(hrvMedian * 10) / 10 : null
  const avgHeartRate = hrN > 0 ? hrSum / hrN : null
  const recoverySeries = Array.from(hrBins.entries())
    .filter(([, b]) => b.n > 0)
    .map(([bin, b]) => ({ bin, bpm: b.sum / b.n }))
  return { averageHrvMs, avgHeartRate, restingHr, rmssdValues: rmssd.map(s => s.value), recoverySeries }
}

function newWay(metRows: Row[], hrvRows: Row[], ibiRows: Row[]) {
  const metExclusion = metExclusionWindows(metRows)
  const nightHr = nightlyHeartRate(ibiRows, metExclusion)
  const nightRmssd = rmssdSamples(hrvRows)
  return {
    averageHrvMs: hrvMsFromSamples(nightRmssd, metExclusion),
    avgHeartRate: nightHr.averageHrBpm,
    restingHr: nightHr.restingHrBpm,
    rmssdValues: nightRmssd.map(s => s.value),
    recoverySeries: nightHr.bins.map(b => ({ bin: b.bin, bpm: b.averageBpm })),
  }
}

// Deterministic PRNG so a failure is reproducible (Math.random is unavailable in some harnesses
// and would make a red run unreplayable anyway).
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

describe('night-vitals is equivalent to the pre-extraction inline algorithm', () => {
  it('agrees on 400 randomised nights, including degenerate ones', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = makeRng(seed)
      const pick = (n: number) => Math.floor(rnd() * n)
      const mk = (count: number, key: string, gen: () => number, key2?: string, gen2?: () => number): Row[] =>
        Array.from({ length: count }, () => ({
          ds: pick(200000),
          decoded: key2
            ? { [key]: Array.from({ length: pick(6) }, gen), [key2]: Array.from({ length: pick(6) }, gen2!) }
            : { [key]: Array.from({ length: pick(6) }, gen) },
        }))
      // Values deliberately straddle every threshold: 35/150 band, 1.8 MET, 3-beat floor, 0 rmssd.
      const metRows = mk(pick(5), 'met', () => rnd() * 4)
      const hrvRows = mk(pick(6), 'rmssd_ms', () => rnd() * 120, 'hr_bpm', () => 20 + rnd() * 160)
      const ibiRows = mk(pick(8), 'hr_bpm', () => 20 + rnd() * 160)

      const a = oldWay(metRows, hrvRows, ibiRows)
      const b = newWay(metRows, hrvRows, ibiRows)
      // Sort the recovery series: the old code iterated Map insertion order, the new one sorts.
      // Same set, different order — assert on the set.
      const norm = (x: typeof a) => ({ ...x, recoverySeries: [...x.recoverySeries].sort((p, q) => p.bin - q.bin) })
      expect(norm(b), `seed ${seed}`).toEqual(norm(a))
    }
  })
})
