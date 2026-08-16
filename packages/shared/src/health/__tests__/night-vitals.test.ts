import { describe, it, expect } from 'vitest'
import {
  metExclusionWindows,
  rmssdSamples,
  hrvMsFromSamples,
  nightlyHrvMs,
  nightlyHeartRate,
  numericField,
  HR_BIN_DS,
  HRV_PAIR_DS,
  MET_SAMPLE_STEP_DS,
} from '../night-vitals'

/** One 0x5d-style event: rmssd pairs with their paired hr, on the 5-minute grid. */
const hrvRow = (ds: number, rmssd: number[], hr: number[]) => ({ ds, decoded: { rmssd_ms: rmssd, hr_bpm: hr } })
/** One IBI-style event: a run of beats attributed to a single timestamp. */
const ibiRow = (ds: number, bpm: number[]) => ({ ds, decoded: { hr_bpm: bpm } })
const metRow = (ds: number, met: number[]) => ({ ds, decoded: { met } })

describe('numericField', () => {
  it('survives a missing key, a null payload and a non-array value', () => {
    expect(numericField(null, 'met')).toEqual([])
    expect(numericField({}, 'met')).toEqual([])
    expect(numericField({ met: 3 }, 'met')).toEqual([])
  })

  it('drops non-numeric entries rather than passing them through', () => {
    expect(numericField({ met: [1, 'x', null, 2] }, 'met')).toEqual([1, 2])
  })
})

describe('metExclusionWindows', () => {
  it('lays each event out on the 1-minute grid', () => {
    // Third value (index 2) is the only active one, so the window centres two minutes in.
    const windows = metExclusionWindows([metRow(0, [1.0, 1.2, 3.5, 1.1])])
    expect(windows).toHaveLength(1)
    expect(windows[0].startDs).toBeLessThanOrEqual(2 * MET_SAMPLE_STEP_DS)
    expect(windows[0].endDs).toBeGreaterThanOrEqual(2 * MET_SAMPLE_STEP_DS)
  })

  it('is empty for a night spent at rest', () => {
    expect(metExclusionWindows([metRow(0, [0.9, 1.0, 1.1, 1.0])])).toEqual([])
  })
})

describe('rmssdSamples — the accuracy proxy', () => {
  it('staggers pairs onto the 5-minute grid so the MET gate can line up', () => {
    const samples = rmssdSamples([hrvRow(1000, [50, 60], [55, 56])])
    expect(samples.map(s => s.ds)).toEqual([1000, 1000 + HRV_PAIR_DS])
  })

  it('drops a pair whose paired heart rate is implausible', () => {
    // 30 bpm is exactly the decoder's 2000 ms interval cap — an artifact, not a reading.
    const samples = rmssdSamples([hrvRow(0, [50, 60, 70], [55, 30, 200])])
    expect(samples.map(s => s.value)).toEqual([50])
  })

  it('drops a non-positive rmssd but keeps a pair with no paired hr at all', () => {
    expect(rmssdSamples([hrvRow(0, [0, 45], [])]).map(s => s.value)).toEqual([45])
  })
})

describe('nightlyHrvMs', () => {
  it('is a median, not a mean — one outlier must not move it', () => {
    const rows = [hrvRow(0, [40, 45, 50, 500], [60, 60, 60, 60])]
    // mean would be ~159; median of [40,45,50,500] is 47.5
    expect(nightlyHrvMs(rows, [])).toBe(47.5)
  })

  it('rounds to a tenth', () => {
    expect(nightlyHrvMs([hrvRow(0, [40.04, 40.04], [60, 60])], [])).toBe(40)
  })

  it('returns null when every sample is gated out rather than 0', () => {
    expect(nightlyHrvMs([hrvRow(0, [50], [200])], [])).toBeNull()
    expect(nightlyHrvMs([], [])).toBeNull()
  })

  // The pinned rule: MET gating happens BEFORE the median, so an active stretch cannot move the
  // night's headline. Chosen so the gated and ungated answers differ — a fixture where they agree
  // would pass with the gate removed and prove nothing.
  it('excludes samples inside a MET active window, changing the answer', () => {
    const hrv = [hrvRow(0, [40, 40, 200, 200], [60, 60, 60, 60])]
    expect(rmssdSamples(hrv).map(s => s.value)).toEqual([40, 40, 200, 200])
    expect(nightlyHrvMs(hrv, [])).toBe(120) // median of all four

    // Cover the two 200s, at 2× and 3× HRV_PAIR_DS.
    const gate = [{ startDs: 2 * HRV_PAIR_DS - 1, endDs: 3 * HRV_PAIR_DS + 1 }]
    expect(hrvMsFromSamples(rmssdSamples(hrv), gate)).toBe(40)
  })
})

describe('nightlyHeartRate', () => {
  it('resting HR is the lowest BIN AVERAGE, never the raw per-beat minimum', () => {
    // Bin 0 holds one 36 bpm outlier among 60s; a raw min() would report 36.
    const rows = [
      ibiRow(0, [60, 60, 60, 36]),
      ibiRow(HR_BIN_DS, [50, 50, 50]),
    ]
    const out = nightlyHeartRate(rows, [])
    expect(out.restingHrBpm).toBe(50)
  })

  it('ignores a bin with too few beats to trust', () => {
    const rows = [
      ibiRow(0, [60, 60, 60]),
      ibiRow(HR_BIN_DS, [40, 40]), // only 2 beats — below MIN_BEATS_PER_BIN
    ]
    expect(nightlyHeartRate(rows, []).restingHrBpm).toBe(60)
  })

  it('ignores a bin overlapping a MET active window — the same gate HRV uses', () => {
    const rows = [
      ibiRow(0, [60, 60, 60]),
      ibiRow(HR_BIN_DS, [45, 45, 45]),
    ]
    expect(nightlyHeartRate(rows, []).restingHrBpm).toBe(45)
    const gated = nightlyHeartRate(rows, [{ startDs: HR_BIN_DS + 10, endDs: HR_BIN_DS + 20 }])
    expect(gated.restingHrBpm).toBe(60)
  })

  it('band-filters artifacts out of the average as well as the bins', () => {
    const out = nightlyHeartRate([ibiRow(0, [60, 60, 30, 200])], [])
    expect(out.beatCount).toBe(2)
    expect(out.averageHrBpm).toBe(60)
  })

  it('reports nulls rather than 0 or NaN for a night with no usable beats', () => {
    const out = nightlyHeartRate([ibiRow(0, [30, 200])], [])
    expect(out.restingHrBpm).toBeNull()
    expect(out.averageHrBpm).toBeNull()
    expect(out.beatCount).toBe(0)
    expect(out.bins).toEqual([])
  })

  // The Recovery Index consumes these; it wants the shape of the whole night, so a bin excluded
  // from resting HR must still appear here.
  it('returns every non-empty bin in order, including ones resting HR disqualified', () => {
    const rows = [
      ibiRow(0, [60, 60, 60]),
      ibiRow(HR_BIN_DS, [40, 40]), // too few beats for resting HR
      ibiRow(2 * HR_BIN_DS, [55, 55, 55]),
    ]
    const out = nightlyHeartRate(rows, [])
    expect(out.bins.map(b => b.bin)).toEqual([0, 1, 2])
    expect(out.bins.map(b => b.averageBpm)).toEqual([60, 40, 55])
    expect(out.restingHrBpm).toBe(55)
  })

  it('merges beats that share a bin even when they arrive on separate events', () => {
    const out = nightlyHeartRate([ibiRow(0, [60, 60]), ibiRow(10, [90, 90])], [])
    expect(out.bins).toHaveLength(1)
    expect(out.bins[0].beatCount).toBe(4)
    expect(out.bins[0].averageBpm).toBe(75)
  })
})
