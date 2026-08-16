import { describe, it, expect } from 'vitest'
import { median, medianGated, metActiveWindows, MET_ACTIVE_THRESHOLD } from '../daily-medians'

describe('median', () => {
  it('odd count → middle value', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('even count → mean of the two middle (numpy convention)', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('empty → null', () => {
    expect(median([])).toBeNull()
  })
})

describe('medianGated', () => {
  it('with no exclusions, medians all finite samples', () => {
    const s = [{ ds: 0, value: 40 }, { ds: 10, value: 44 }, { ds: 20, value: 48 }]
    expect(medianGated(s)).toBe(44)
  })

  it('excludes samples inside any exclusion window (median vs naive mean)', () => {
    // A big active-period spike would inflate a mean; gated median drops it.
    const s = [{ ds: 0, value: 40 }, { ds: 100, value: 200 }, { ds: 200, value: 44 }, { ds: 300, value: 42 }]
    const excl = [{ startDs: 90, endDs: 110 }] // covers the 200 spike at ds=100
    expect(medianGated(s, excl)).toBe(42) // median of [40,44,42]
  })

  it('drops non-finite values', () => {
    const s = [{ ds: 0, value: 40 }, { ds: 10, value: NaN }, { ds: 20, value: 44 }]
    expect(medianGated(s)).toBe(42)
  })

  it('returns null when every sample is excluded (no throw)', () => {
    const s = [{ ds: 5, value: 40 }, { ds: 15, value: 44 }]
    expect(medianGated(s, [{ startDs: 0, endDs: 100 }])).toBeNull()
    expect(medianGated([])).toBeNull()
  })
})

describe('metActiveWindows', () => {
  it('opens a forward window after each MET reading above the threshold', () => {
    const met = [{ ds: 100, value: 2.5 }, { ds: 500, value: 1.0 }, { ds: 900, value: 3.0 }]
    const w = metActiveWindows(met, 600)
    expect(w).toEqual([
      { startDs: 100, endDs: 700 },
      { startDs: 900, endDs: 1500 },
    ]) // the MET 1.0 sample (≤ 1.8) opens no window
  })

  it('threshold is 1.8 (exclusive)', () => {
    expect(MET_ACTIVE_THRESHOLD).toBe(1.8)
    expect(metActiveWindows([{ ds: 0, value: 1.8 }], 600)).toEqual([]) // exactly 1.8 → not active
    expect(metActiveWindows([{ ds: 0, value: 1.81 }], 600)).toHaveLength(1)
  })
})
