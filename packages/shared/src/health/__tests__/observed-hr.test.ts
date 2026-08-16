import { describe, it, expect } from 'vitest'
import { computeObservedHr, resolveMaxHr, pctOfMax } from '../observed-hr'

describe('computeObservedHr — robust min/max/avg', () => {
  it('a single stray high reading cannot set the max (needs corroboration)', () => {
    // 200 appears once; the HR genuinely reaches ~150 many times.
    const bpms = [...Array(100).fill(120), ...Array(20).fill(150), 200]
    const p = computeObservedHr(bpms)
    expect(p.max).toBe(150)        // NOT 200
    expect(p.highestPlausible).toBe(200) // surfaced, but not what the max became
    expect(p.max! < 200).toBe(true)
  })

  it('a max reached ≥ corroboration times IS accepted', () => {
    const bpms = [...Array(100).fill(120), 185, 185, 185, 185, 185] // 185 five times (=CORROBORATION)
    expect(computeObservedHr(bpms).max).toBe(185)
  })

  it('drops physiologically implausible readings (sensor errors)', () => {
    const bpms = [...Array(80).fill(130), 0, 5, 300, 500, -1]
    const p = computeObservedHr(bpms)
    expect(p.sampleCount).toBe(80)  // the 5 junk readings excluded
    expect(p.max).toBe(130)
    expect(p.min).toBe(130)
    expect(p.avg).toBe(130)
  })

  it('flags not-reliable below the sample floor but still reports an average', () => {
    const p = computeObservedHr([120, 122, 118])
    expect(p.isReliable).toBe(false)
    expect(p.avg).toBe(120)
    expect(p.max).toBeNull()        // fewer than CORROBORATION readings
  })

  it('is reliable with enough data', () => {
    const p = computeObservedHr(Array.from({ length: 200 }, (_, i) => 60 + (i % 100)))
    expect(p.isReliable).toBe(true)
    expect(p.sampleCount).toBe(200)
  })

  it('handles empty input without throwing', () => {
    expect(computeObservedHr([])).toEqual({
      min: null, max: null, avg: null, sampleCount: 0, isReliable: false, outOfBandRejected: 0, highestPlausible: null,
    })
  })

  it('robust min rejects a single implausibly-low corroboration outlier too', () => {
    const bpms = [...Array(100).fill(140), 45, ...Array(20).fill(60)]
    const p = computeObservedHr(bpms)
    expect(p.min).toBe(60)         // 45 appears once → not the corroborated min
  })
})

describe('resolveMaxHr', () => {
  const reliable = (max: number) => computeObservedHr([...Array(100).fill(120), ...Array(5).fill(max)])

  it('uses the observed max when reliable and ≥ the estimate', () => {
    const r = resolveMaxHr(reliable(195), 185)
    expect(r.source).toBe('observed')
    expect(r.maxUsed).toBe(195)
  })

  it('keeps the estimate when the observed max is lower (you just haven\'t gone hard)', () => {
    const r = resolveMaxHr(reliable(160), 185)
    expect(r.source).toBe('estimated')
    expect(r.maxUsed).toBe(185)
    expect(r.observedMax).toBe(160)
  })

  it('keeps the estimate when observed data is unreliable', () => {
    const r = resolveMaxHr(computeObservedHr([190, 191]), 185)
    expect(r.source).toBe('estimated')
    expect(r.maxUsed).toBe(185)
  })
})

describe('pctOfMax', () => {
  it('expresses effort as a % of the max', () => {
    expect(pctOfMax(150, 200)).toBe(75)
    expect(pctOfMax(190, 190)).toBe(100)
  })
  it('null for a non-positive max', () => {
    expect(pctOfMax(150, 0)).toBeNull()
  })
})

describe('rejection counters report something real', () => {
  it('counts only readings that were physiologically impossible', () => {
    const p = computeObservedHr([...Array(100).fill(120), 0, 300, -5, 500])
    expect(p.outOfBandRejected).toBe(4)
    expect(p.sampleCount).toBe(100)
  })

  it('is zero on clean continuously-varying data', () => {
    // The old `spikesRejected` counted plausible readings above the max. Since the max IS
    // the k-th highest, that is (k-1) minus any ties at the max — 3 on this dataset, 4 on
    // fully-distinct data — regardless of whether a single artefact occurred. It was a
    // function of k and the tie structure, not of sensor faults, and the UI reported it to
    // the user as "N stray high readings ignored". This must stay 0 on clean data.
    const varying = Array.from({ length: 300 }, (_, i) => 60 + (i % 97))
    expect(computeObservedHr(varying).outOfBandRejected).toBe(0)
  })

  it('highestPlausible exposes the gap the corroborated max deliberately leaves', () => {
    const p = computeObservedHr([...Array(100).fill(120), 150, 152, 155, 158, 190])
    expect(p.highestPlausible).toBe(190)
    expect(p.max).toBe(150) // 5th highest — the 190 did not set it
  })

  it('an entirely impossible dataset reports every reading as rejected', () => {
    const p = computeObservedHr([300, 400, 500])
    expect(p.outOfBandRejected).toBe(3)
    expect(p.sampleCount).toBe(0)
    expect(p.max).toBeNull()
  })
})
