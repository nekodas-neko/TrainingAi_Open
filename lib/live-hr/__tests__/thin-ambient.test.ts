import { describe, it, expect } from 'vitest'
import { thinAmbientSamples } from '@/lib/live-hr/chest-strap-source'

const s = (at: number) => ({ at, bpm: 60, rr: [] })

describe('thinAmbientSamples', () => {
  it('keeps the first sample when nothing sent yet', () => {
    const r = thinAmbientSamples([s(1000)], null, 30_000)
    expect(r.kept.map(x => x.at)).toEqual([1000])
    expect(r.lastSentAt).toBe(1000)
  })

  it('drops samples inside the gap, keeps one per gap', () => {
    // 1 Hz for 90 s starting at t=0 → ~1 per 30 s kept: 0, 30_000, 60_000
    const samples = Array.from({ length: 91 }, (_, i) => s(i * 1000))
    const r = thinAmbientSamples(samples, null, 30_000)
    expect(r.kept.map(x => x.at)).toEqual([0, 30_000, 60_000, 90_000])
    expect(r.lastSentAt).toBe(90_000)
  })

  it('carries lastSentAt across flushes so cadence holds across calls', () => {
    const first = thinAmbientSamples([s(0), s(10_000), s(20_000)], null, 30_000)
    expect(first.kept.map(x => x.at)).toEqual([0]) // 10k/20k inside the gap
    // next flush continues from lastSentAt=0
    const second = thinAmbientSamples([s(25_000), s(31_000), s(40_000)], first.lastSentAt, 30_000)
    expect(second.kept.map(x => x.at)).toEqual([31_000]) // 25k inside gap, 31k clears it, 40k inside next gap
  })

  it('returns nothing (and unchanged lastSentAt) for an all-inside-gap window', () => {
    const r = thinAmbientSamples([s(5000), s(6000)], 1000, 30_000)
    expect(r.kept).toEqual([])
    expect(r.lastSentAt).toBe(1000)
  })
})
