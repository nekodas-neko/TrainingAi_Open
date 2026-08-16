import { describe, it, expect } from 'vitest'
import { nightlyTemperatureCentiC, temperatureDeviationCentiC, temperatureFrameSeries } from '../temperature-baseline'

describe('nightlyTemperatureCentiC', () => {
  // Ported verbatim from open_oura's temperature.rs pinned tests.
  it('a steady night at 35.00 degC across 5 windows returns 3500', () => {
    const samples = new Array(150).fill(3500)
    expect(nightlyTemperatureCentiC(samples)).toBe(3500)
  })

  it('returns null with fewer than 4 valid windows', () => {
    expect(nightlyTemperatureCentiC(new Array(60).fill(3500))).toBeNull() // 2 windows
    expect(nightlyTemperatureCentiC(new Array(50).fill(3500))).toBeNull() // 1 window
  })

  it('returns null for an empty night', () => {
    expect(nightlyTemperatureCentiC([])).toBeNull()
  })

  it('takes the minimum of the window maxima, not the overall maximum', () => {
    // 4 windows of 30, each steady but at a different level. The ring buffer isn't
    // reset between windows, so a step at a window boundary bleeds into that
    // window's first few medians (e.g. window 3's drop to 3400 is masked by
    // trailing 3600s for its first 3 samples, pulling its own max to 3600) — this
    // is the ported algorithm's real behaviour, not a test artifact. The nightly
    // value is still the minimum across all 4 window maxima (3500, from window 1,
    // which had no preceding contamination), never the night's peak (3600).
    const windows = [3500, 3600, 3400, 3550].flatMap(v => new Array(30).fill(v))
    expect(nightlyTemperatureCentiC(windows)).toBe(3500)
  })

  it('discards a window whose range is >= 2.50 degC (noisy/unreliable)', () => {
    // A window alternating between 3400 and 3700 has range 300 (3.00 degC) — over
    // the 250 (2.50 degC) gate, so it's discarded and the 4-window minimum falls
    // below the required count.
    const noisyWindow = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 3400 : 3700))
    const cleanWindows = new Array(90).fill(3500) // 3 clean windows
    expect(nightlyTemperatureCentiC([...cleanWindows, ...noisyWindow])).toBeNull() // only 3 valid
  })
})

describe('temperatureDeviationCentiC', () => {
  it('is nightly minus baseline mean', () => {
    expect(temperatureDeviationCentiC(3550, 3500)).toBe(50)
    expect(temperatureDeviationCentiC(3450, 3500)).toBe(-50)
  })
})

describe('temperatureFrameSeries', () => {
  it('emits one sample per frame, not one per probe', () => {
    // The bug this exists to prevent: three probes read at one instant were pushed as
    // three samples sharing one timestamp, so 631 frames became 2,398 "samples" and the
    // temporal pipeline read probe position as elapsed time.
    const frames = [
      { ds: 10, tempsC: [35.0, 35.5, 36.0] },
      { ds: 20, tempsC: [35.1, 35.6, 36.1] },
    ]
    expect(temperatureFrameSeries(frames)).toHaveLength(2)
  })

  it('takes the middle probe of an odd-length frame', () => {
    expect(temperatureFrameSeries([{ ds: 1, tempsC: [35.0, 35.5, 36.0] }])[0].centi).toBe(3550)
  })

  it('averages the two middle probes of an even-length frame, rounded to centi', () => {
    // 35.50 and 35.61 -> 3550 and 3561 -> 3555.5 -> 3556
    expect(temperatureFrameSeries([{ ds: 1, tempsC: [35.0, 35.5, 35.61, 36.0] }])[0].centi).toBe(3556)
  })

  it('resists a single wild probe (the reason for median over mean/max)', () => {
    expect(temperatureFrameSeries([{ ds: 1, tempsC: [35.4, 35.5, 84.0] }])[0].centi).toBe(3550)
  })

  it('orders by ds and keeps one timestamp per sample', () => {
    const out = temperatureFrameSeries([
      { ds: 30, tempsC: [36.0] },
      { ds: 10, tempsC: [35.0] },
      { ds: 20, tempsC: [35.5] },
    ])
    expect(out.map(s => s.ds)).toEqual([10, 20, 30])
    expect(out.map(s => s.centi)).toEqual([3500, 3550, 3600])
  })

  it('skips frames that decoded to no values rather than emitting a zero', () => {
    // 0 is the pipeline's "invalid" sentinel — emitting one would corrupt a window.
    expect(temperatureFrameSeries([{ ds: 1, tempsC: [] }, { ds: 2, tempsC: [35.0] }]))
      .toEqual([{ ds: 2, centi: 3500 }])
  })
})
