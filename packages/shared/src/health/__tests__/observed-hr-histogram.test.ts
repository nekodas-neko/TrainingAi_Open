// #3774 — `observedHrFromCounts` reads the observed profile off a count per bpm, so the server can
// keep the closed part of a window and add today's readings to it. It must give the profile
// `computeObservedHr` gives for the same readings, field for field: this profile sets the
// heart-rate zone boundaries. Nothing here states an expected number; both sides are computed.
import { describe, it, expect } from 'vitest'
import {
  computeObservedHr, observedHrFromCounts, CORROBORATION, MIN_RELIABLE_SAMPLES,
  PLAUSIBLE_MIN_BPM, PLAUSIBLE_MAX_BPM,
} from '../observed-hr'

const countsOf = (bpms: readonly number[]) => {
  const m = new Map<number, number>()
  for (const b of bpms) m.set(b, (m.get(b) ?? 0) + 1)
  return m
}
const agree = (bpms: readonly number[]) => expect(observedHrFromCounts(countsOf(bpms))).toEqual(computeObservedHr(bpms))

/** A fixed-seed generator, so a failure names the same readings on every run. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}

describe('observedHrFromCounts matches computeObservedHr', () => {
  it('on nothing, and on only out-of-band readings', () => {
    agree([])
    agree([0, 0, 300, PLAUSIBLE_MIN_BPM - 1, PLAUSIBLE_MAX_BPM + 1])
  })

  it('either side of the corroboration depth', () => {
    for (const n of [1, CORROBORATION - 1, CORROBORATION, CORROBORATION + 1]) {
      agree(Array.from({ length: n }, (_, i) => 100 + i * 7))
    }
  })

  it('either side of the reliability threshold', () => {
    for (const n of [MIN_RELIABLE_SAMPLES - 1, MIN_RELIABLE_SAMPLES, MIN_RELIABLE_SAMPLES + 1]) {
      agree(Array.from({ length: n }, (_, i) => 60 + (i % 40)))
    }
  })

  it('at both edges of the plausible band', () => {
    agree([...Array(10).fill(PLAUSIBLE_MIN_BPM), ...Array(10).fill(PLAUSIBLE_MAX_BPM), PLAUSIBLE_MIN_BPM - 1, PLAUSIBLE_MAX_BPM + 1])
  })

  it('with ties at the k-th value and spikes above it', () => {
    agree([...Array(200).fill(150), 210, 210, 210, 210])
    agree([...Array(200).fill(150), ...Array(CORROBORATION).fill(190)])
    agree([...Array(3).fill(40), ...Array(2).fill(41), ...Array(200).fill(70), ...Array(2).fill(180), ...Array(3).fill(181)])
  })

  it('with a mean that lands exactly on a half', () => {
    agree([70, 71, 70, 71, 70, 71])
    agree([99, 100, 100, 101, 100, 101])
  })

  it('on 300 random reading sets', () => {
    const rnd = seeded(3774)
    for (let run = 0; run < 300; run++) {
      const n = Math.floor(rnd() * 400)
      const lo = 20 + Math.floor(rnd() * 60)
      const span = 1 + Math.floor(rnd() * 180)
      agree(Array.from({ length: n }, () => lo + Math.floor(rnd() * span)))
    }
  })

  it('adds: the profile of two parts is the profile of their summed counts', () => {
    const rnd = seeded(181)
    const a = Array.from({ length: 500 }, () => 45 + Math.floor(rnd() * 120))
    const b = Array.from({ length: 37 }, () => 25 + Math.floor(rnd() * 210))
    const summed = new Map(countsOf(a))
    for (const [bpm, n] of countsOf(b)) summed.set(bpm, (summed.get(bpm) ?? 0) + n)
    expect(observedHrFromCounts(summed)).toEqual(computeObservedHr([...a, ...b]))
  })
})
