// lib/health/__tests__/rmssd.test.ts
import { describe, it, expect } from 'vitest'
import { rmssdFromRr, type RrBeat } from '@trainingai/shared/health/rmssd'

/** Beats laid end to end from `startMs`, the way the strap route reconstructs them: each beat's
 *  time is when it ENDED, so the gap to the previous beat is its own interval. */
function consecutive(rr: number[], startMs = 1_000_000): RrBeat[] {
  let t = startMs
  return rr.map(rrMs => ({ atMs: (t += rrMs), rrMs }))
}

describe('rmssdFromRr', () => {
  it('computes rMSSD over successive differences', () => {
    // 30 beats alternating 800/820 → every successive diff is ±20 → rMSSD = 20
    const rr = Array.from({ length: 30 }, (_, i) => (i % 2 ? 820 : 800))
    expect(rmssdFromRr(consecutive(rr))).toBeCloseTo(20, 5)
  })

  it('returns null with fewer than 30 beats (too little signal)', () => {
    expect(rmssdFromRr(consecutive(Array.from({ length: 29 }, () => 800)))).toBeNull()
  })

  it('excludes artifact pairs (>20% jump) from the differences', () => {
    // A 300 ms ectopic jump inside otherwise steady 800s must not dominate.
    const steady = Array.from({ length: 40 }, () => 800)
    const withArtifact = [...steady.slice(0, 20), 1100, ...steady.slice(21)]
    const clean = rmssdFromRr(consecutive(steady))!
    const filtered = rmssdFromRr(consecutive(withArtifact))!
    expect(filtered).toBeLessThan(clean + 5)
  })

  it('is null when everything is filtered', () => {
    // Alternating wild values: every pair is an artifact.
    expect(rmssdFromRr(consecutive(Array.from({ length: 40 }, (_, i) => (i % 2 ? 400 : 1600))))).toBeNull()
  })

  it('does not depend on the order the beats arrive in', () => {
    const beats = consecutive(Array.from({ length: 40 }, (_, i) => (i % 2 ? 820 : 800)))
    expect(rmssdFromRr([...beats].reverse())).toBeCloseTo(rmssdFromRr(beats)!, 9)
  })
})

// #2488. In the strap's sparse mode (about 60% of half-hours) the beats arrive in short runs with
// gaps between them, and the old version differenced across the gaps. Two beats a minute apart are
// not successive: their difference is the drift of the heart rate, not beat-to-beat variability.
// Counted only over truly adjacent pairs, daytime RMSSD read 25–32 ms where this read 76–93.
describe('rmssdFromRr counts only beats that are actually adjacent (#2488)', () => {
  /** `runs` runs of two adjacent beats (base ±10, so the true adjacent difference is 20 ms), each
   *  run starting a minute after the last, with the heart rate wandering between runs. */
  function sparse(runs: number, bases = [800, 950]): { beats: RrBeat[]; allRr: number[] } {
    const beats: RrBeat[] = []
    for (let r = 0; r < runs; r++) {
      const base = bases[r % bases.length]
      const t0 = 5_000_000 + r * 60_000
      beats.push({ atMs: t0 + base - 10, rrMs: base - 10 }, { atMs: t0 + 2 * base, rrMs: base + 10 })
    }
    return { beats, allRr: beats.map(b => b.rrMs) }
  }

  it('reads the beat-to-beat variability, not the drift between runs', () => {
    const { beats } = sparse(20)
    // Every adjacent pair differs by exactly 20 ms.
    expect(rmssdFromRr(beats)).toBeCloseTo(20, 5)
  })

  it('is what the old version got wrong: differencing the same values blindly reads about 3x high', () => {
    const { beats, allRr } = sparse(20)
    // The old arithmetic, kept here only to prove the fixture reproduces the defect: every pair in
    // sequence, including across the gaps (a 150 ms hop still passes the 20% artifact gate).
    const sq: number[] = []
    for (let i = 1; i < allRr.length; i++) {
      if (Math.abs(allRr[i] - allRr[i - 1]) > 0.2 * allRr[i - 1]) continue
      sq.push((allRr[i] - allRr[i - 1]) ** 2)
    }
    const old = Math.sqrt(sq.reduce((s, v) => s + v, 0) / sq.length)
    expect(old).toBeGreaterThan(60)
    expect(rmssdFromRr(beats)!).toBeLessThan(old / 2)
  })

  it('drops the pair that straddles a gap even when the values look plausible', () => {
    // Four runs of ten steady beats at 800, then a minute later four runs at 900. Within a run the
    // difference is 0; across runs it is 100, which passes the artifact gate.
    const beats: RrBeat[] = []
    for (let r = 0; r < 8; r++) {
      const base = r < 4 ? 800 : 900
      let t = 9_000_000 + r * 120_000
      for (let i = 0; i < 10; i++) beats.push({ atMs: (t += base), rrMs: base })
    }
    expect(rmssdFromRr(beats)).toBeCloseTo(0, 9)
  })

  it('is null when no pair is adjacent, not a number built from non-neighbours', () => {
    // 40 beats, each a minute from the next.
    const beats = Array.from({ length: 40 }, (_, i) => ({ atMs: 1_000_000 + i * 60_000, rrMs: 800 + (i % 2) * 20 }))
    expect(rmssdFromRr(beats)).toBeNull()
  })

  it('tolerates the jitter of a reconstructed timestamp (a packet boundary)', () => {
    // Real beat times are rebuilt from client receive times, so a boundary can be off by tens of ms.
    const rr = Array.from({ length: 40 }, (_, i) => (i % 2 ? 820 : 800))
    const beats = consecutive(rr).map((b, i) => ({ ...b, atMs: b.atMs + (i % 3) * 40 }))
    expect(rmssdFromRr(beats)).not.toBeNull()
  })

  it('does not call a missed beat adjacent: one lost beat doubles the gap', () => {
    const rr = Array.from({ length: 80 }, (_, i) => (i % 2 ? 820 : 800))
    const beats = consecutive(rr)
    // 80 beats, so the 40 that remain clear the beat-count floor and the null below can only come
    // from adjacency: each remaining pair now spans two intervals.
    const everyOther = beats.filter((_, i) => i % 2 === 0)
    expect(everyOther).toHaveLength(40)
    expect(rmssdFromRr(everyOther)).toBeNull()
  })
})
