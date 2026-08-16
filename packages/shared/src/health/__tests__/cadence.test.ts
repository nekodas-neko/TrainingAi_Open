import { describe, it, expect } from 'vitest'
import {
  bandAutocorrPeak,
  cadenceFromStrideHz,
  detectCadence,
  summarizeCadence,
  cadenceFieldsForSave,
  compareCadence,
  isPlausibleCadence,
  supportsCadence,
  RING_STRIDE_HZ_TO_SPM,
  RING_STRIDE_INTERPRETATIONS,
  CADENCE_MIN_HZ,
  CADENCE_MAX_HZ,
  CADENCE_SERIES_BIN_SEC,
  CADENCE_AGREEMENT_SPM,
  MIN_PLAUSIBLE_SPM,
  MAX_PLAUSIBLE_SPM,
  type CadenceReading,
} from '@trainingai/shared/health/cadence'

/** Clean footfall rhythm: a sine at `stepHz` plus gravity DC and a little deterministic noise. */
function synthGait(stepHz: number, seconds: number, rate: number): number[] {
  const n = Math.round(seconds * rate)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / rate
    out.push(1000 + 400 * Math.sin(2 * Math.PI * stepHz * t) + ((i * 37) % 11) - 5)
  }
  return out
}

/**
 * Physically-shaped gait: a train of raised-cosine footfall impulses at `stepHz`, with
 * alternate footfalls scaled by `asymmetry` (1 = perfectly even, <1 = one leg strikes
 * lighter — the left/right asymmetry every real runner has).
 *
 * An impulse train is the right model here and a sum of sines is not. With asymmetry the
 * waveform's true period is the STRIDE (two steps), so the tallest autocorrelation peak sits
 * at the stride lag while the step lag still correlates at ~2AB/(A²+B²) — 0.94 for
 * asymmetry 0.7. That near-miss is precisely what octave correction is built to rescue.
 */
function synthFootfalls(stepHz: number, seconds: number, rate: number, asymmetry = 1): number[] {
  const n = Math.round(seconds * rate)
  const out = new Array<number>(n).fill(1000)
  const stepPeriod = rate / stepHz
  const half = stepPeriod * 0.25
  for (let k = 0; k * stepPeriod < n; k++) {
    const center = k * stepPeriod
    const amp = 400 * (k % 2 === 0 ? 1 : asymmetry)
    for (let i = Math.max(0, Math.ceil(center - half)); i < Math.min(n, center + half); i++) {
      out[i] += amp * 0.5 * (1 + Math.cos(Math.PI * ((i - center) / half)))
    }
  }
  return out.map((v, i) => v + ((i * 37) % 11) - 5)
}

/**
 * Deterministic pseudo-random noise. A modular ramp like `(i*131)%900` looks unstructured
 * but is a Weyl sequence with real periodicity — the DSP correctly finds a rhythm in it, so
 * it cannot stand in for aperiodic motion. An LCG has no such structure.
 */
function aperiodic(n: number): number[] {
  let seed = 12345
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    out.push(1000 + (seed / 2147483648) * 900 - 450)
  }
  return out
}

describe('bandAutocorrPeak', () => {
  it('recovers the driving frequency of a clean rhythm', () => {
    const peak = bandAutocorrPeak(synthGait(3.0, 8, 200), 200, CADENCE_MIN_HZ, CADENCE_MAX_HZ)
    expect(peak).not.toBeNull()
    expect(peak!.hz).toBeCloseTo(3.0, 1)
    expect(peak!.strength).toBeGreaterThan(0.5)
  })

  it('sub-sample interpolation beats raw integer-lag resolution at a low sample rate', () => {
    // At 50 Hz a 3 Hz rhythm sits at lag 16.67; integer lags 16/17 give 3.125/2.94 Hz.
    // Without interpolation the answer must snap to one of those; with it, it should not.
    const signal = synthGait(3.0, 8, 50)
    const raw = bandAutocorrPeak(signal, 50, CADENCE_MIN_HZ, CADENCE_MAX_HZ, { interpolate: false })
    const interpolated = bandAutocorrPeak(signal, 50, CADENCE_MIN_HZ, CADENCE_MAX_HZ)

    expect(raw!.hz).not.toBeCloseTo(3.0, 2)
    expect(Math.abs(interpolated!.hz - 3.0)).toBeLessThan(Math.abs(raw!.hz - 3.0))
    expect(interpolated!.hz).toBeCloseTo(3.0, 1)
  })

  it('octave correction recovers step rate when the stride harmonic is stronger', () => {
    const signal = synthFootfalls(2.8, 10, 100, 0.7)
    const uncorrected = bandAutocorrPeak(signal, 100, CADENCE_MIN_HZ, CADENCE_MAX_HZ, {
      octaveCorrect: false,
    })
    const corrected = bandAutocorrPeak(signal, 100, CADENCE_MIN_HZ, CADENCE_MAX_HZ)

    // The naive peak locks onto the stride (half-cadence) harmonic...
    expect(uncorrected!.hz).toBeCloseTo(1.4, 1)
    // ...and the correction recovers the real step rate.
    expect(corrected!.hz).toBeCloseTo(2.8, 1)
  })

  it('leaves symmetric gait alone — octave correction must not double a correct reading', () => {
    const peak = bandAutocorrPeak(synthFootfalls(2.8, 10, 100), 100, CADENCE_MIN_HZ, CADENCE_MAX_HZ)
    expect(peak!.hz).toBeCloseTo(2.8, 1)
  })

  it('returns null for a flat window, a degenerate band, or a bad sample rate', () => {
    expect(bandAutocorrPeak(new Array(200).fill(1000), 100, 1.2, 3.7)).toBeNull()
    expect(bandAutocorrPeak(synthGait(3, 4, 100), 100, 3.7, 1.2)).toBeNull()
    expect(bandAutocorrPeak(synthGait(3, 4, 100), 0, 1.2, 3.7)).toBeNull()
    expect(bandAutocorrPeak([], 100, 1.2, 3.7)).toBeNull()
  })
})

describe('cadenceFromStrideHz', () => {
  it('converts stride frequency to spm with the default (steps/s) interpretation', () => {
    expect(cadenceFromStrideHz(2.5)).toBeCloseTo(150, 5)
    expect(RING_STRIDE_HZ_TO_SPM).toBe(60)
  })

  it('matches the owner treadmill capture that resolved the units question', () => {
    // 2026-07-27, treadmill 2.7 km/h, counted 48 steps / 30 s = 96 spm.
    // Decoded stride_frequency 1.7233 Hz. x60 lands near truth; x120 is ~2.15x out.
    const STRIDE_HZ = 1.7232876712328764
    const TRUTH_SPM = 96
    const at60 = cadenceFromStrideHz(STRIDE_HZ, 60)!
    const at120 = cadenceFromStrideHz(STRIDE_HZ, 120)!

    expect(Math.abs(at60 - TRUTH_SPM)).toBeLessThan(10)
    // x120 survives the plausibility bounds (206.8 is under the 220 ceiling — a sprinter's
    // cadence is a real thing), so the bounds alone could never have settled this. It is the
    // comparison against counted ground truth that does: ~2.15x out, nowhere near agreement.
    expect(at120).toBeGreaterThan(200)
    expect(at120 / TRUTH_SPM).toBeGreaterThan(2)
    expect(Math.abs(at120 - TRUTH_SPM)).toBeGreaterThan(CADENCE_AGREEMENT_SPM * 10)
    expect(RING_STRIDE_HZ_TO_SPM).toBe(60)
  })

  it('supports the alternate strides/s interpretation, which differs by exactly 2x', () => {
    const [stepsPerSec, stridesPerSec] = RING_STRIDE_INTERPRETATIONS
    expect(stridesPerSec.factor / stepsPerSec.factor).toBe(2)
    expect(cadenceFromStrideHz(1.5, stridesPerSec.factor)).toBeCloseTo(180, 5)
  })

  it('returns null rather than 0 for a non-locomotor or implausible window', () => {
    expect(cadenceFromStrideHz(0)).toBeNull()
    expect(cadenceFromStrideHz(-1)).toBeNull()
    expect(cadenceFromStrideHz(Number.NaN)).toBeNull()
    expect(cadenceFromStrideHz(0.5)).toBeNull()  // 30 spm — below a slow walk
    expect(cadenceFromStrideHz(10)).toBeNull()   // 600 spm — not a person
  })
})

describe('detectCadence', () => {
  // The GO threshold for this metric is a few spm, so assert tightly.
  it.each([
    [2.0, 120],
    [2.6, 156],
    [3.0, 180],
    [3.2, 192],
  ])('recovers %s Hz as ~%s spm at 50 Hz within 3 spm', (stepHz, expectedSpm) => {
    const est = detectCadence(synthGait(stepHz, 10, 50), 50)
    expect(est).not.toBeNull()
    expect(Math.abs(est!.cadenceSpm - expectedSpm)).toBeLessThanOrEqual(3)
    expect(est!.strength).toBeGreaterThan(0.4)
  })

  it('recovers walking cadence, not just running', () => {
    const est = detectCadence(synthGait(1.7, 10, 50), 50) // 102 spm — an ordinary walk
    expect(est).not.toBeNull()
    expect(Math.abs(est!.cadenceSpm - 102)).toBeLessThanOrEqual(3)
  })

  it('reports the step rate for asymmetric gait, not the stride rate', () => {
    const est = detectCadence(synthFootfalls(2.8, 10, 100, 0.7), 100)
    expect(est).not.toBeNull()
    expect(Math.abs(est!.cadenceSpm - 168)).toBeLessThanOrEqual(5)
  })

  it('returns null for aperiodic motion, short windows, and bad rates', () => {
    expect(detectCadence(aperiodic(1000), 50)).toBeNull()
    expect(detectCadence(synthGait(3.0, 1, 50), 50)).toBeNull() // 1 s < MIN_WINDOW_SEC
    expect(detectCadence(synthGait(3.0, 10, 50), 0)).toBeNull()
    expect(detectCadence([], 50)).toBeNull()
  })
})

describe('isPlausibleCadence', () => {
  it('bounds readings to a human range', () => {
    expect(isPlausibleCadence(MIN_PLAUSIBLE_SPM)).toBe(true)
    expect(isPlausibleCadence(MAX_PLAUSIBLE_SPM)).toBe(true)
    expect(isPlausibleCadence(MIN_PLAUSIBLE_SPM - 1)).toBe(false)
    expect(isPlausibleCadence(MAX_PLAUSIBLE_SPM + 1)).toBe(false)
    expect(isPlausibleCadence(Number.NaN)).toBe(false)
  })
})

describe('summarizeCadence', () => {
  const start = 1_000_000

  const readings = (specs: Array<[sec: number, spm: number, src?: 'ring' | 'strap']>): CadenceReading[] =>
    specs.map(([sec, spm, src]) => ({ atMs: start + sec * 1000, spm, source: src ?? 'strap' }))

  it('averages only locomotor readings and bins the series by median', () => {
    const out = summarizeCadence(
      readings([[0, 170], [3, 172], [6, 168], [12, 180], [15, 176]]),
      start,
    )
    expect(out.readingCount).toBe(5)
    // Median of 168/170/172/176/180.
    expect(out.avgSpm).toBeCloseTo(172, 1)
    expect(out.series).toEqual([
      { tSec: 0, spm: 170 },
      { tSec: CADENCE_SERIES_BIN_SEC, spm: 178 },
    ])
  })

  it('drops implausible readings so a stop does not drag the average down', () => {
    const withStops = summarizeCadence(readings([[0, 170], [3, 0], [6, 170]]), start)
    expect(withStops.readingCount).toBe(2)
    expect(withStops.avgSpm).toBe(170)
  })

  it('attributes the row to whichever source contributed most readings', () => {
    const out = summarizeCadence(
      readings([[0, 170, 'ring'], [3, 172, 'strap'], [6, 168, 'strap']]),
      start,
    )
    expect(out.source).toBe('strap')
  })

  it('a single octave mis-lock cannot move the reported average (2026-07-27 capture)', () => {
    // Real shape: a 64 spm walk where one window doubled to 140.8. A mean gives 73.6 (+9.6);
    // the median gives 63.8 (-0.2). One bad window must not move the number a user sees.
    const out = summarizeCadence(
      readings([[0, 60.9], [12, 140.8], [24, 66.1], [36, 61.5],
                [48, 60.3], [60, 69.8], [72, 68.6], [84, 61]]),
      start,
    )
    expect(Math.abs(out.avgSpm! - 64)).toBeLessThan(2)
  })

  it('returns an empty summary rather than zeros when nothing locomotor was seen', () => {
    expect(summarizeCadence([], start)).toEqual({
      avgSpm: null, series: [], source: null, readingCount: 0, stepsEstimate: null,
    })
    expect(summarizeCadence(readings([[0, 0], [5, 5]]), start).avgSpm).toBeNull()
  })

  it('clamps readings before the nominal start to t=0 instead of emitting negative time', () => {
    const out = summarizeCadence(
      [{ atMs: start - 4000, spm: 170, source: 'ring' }],
      start,
    )
    expect(out.series[0].tSec).toBe(0)
  })
})

describe('band-edge rejection (regression: owner capture 2026-07-27)', () => {
  it('never reports a cadence sitting exactly on a band edge', () => {
    // A rhythm below the search band: the correlation is still climbing as the scan runs off
    // the bottom, so the argmax lands on the floor. Reporting that edge value is what made a
    // real 102 spm walk read as a confident, unvarying 71.4 spm.
    const belowBand = synthGait(0.6, 12, 50)
    const peak = bandAutocorrPeak(belowBand, 50, CADENCE_MIN_HZ, CADENCE_MAX_HZ)
    if (peak) {
      // If anything is returned it must be a real interior peak, not the boundary.
      expect(peak.hz).toBeGreaterThan(CADENCE_MIN_HZ + 0.01)
      expect(peak.hz).toBeLessThan(CADENCE_MAX_HZ - 0.01)
    }
    expect(detectCadence(belowBand, 50)).toBeNull()
  })

  it('the search band lies strictly outside the plausibility bounds at both ends', () => {
    // Otherwise an unreachable-but-plausible cadence pins to the edge instead of being
    // rejected — the exact inconsistency behind the 71.4 reading.
    expect(CADENCE_MIN_HZ * 60).toBeLessThan(MIN_PLAUSIBLE_SPM)
    expect(CADENCE_MAX_HZ * 60).toBeGreaterThan(MAX_PLAUSIBLE_SPM)
  })

  it('still recovers an ordinary walk near the old floor', () => {
    // ~75 spm shuffle: previously unreachable (band floor was 72 spm), now a real reading.
    const est = detectCadence(synthGait(1.25, 12, 50), 50)
    expect(est).not.toBeNull()
    expect(Math.abs(est!.cadenceSpm - 75)).toBeLessThanOrEqual(3)
  })
})

describe('supportsCadence', () => {
  it('covers foot-based activities including the non-distance-based treadmill', () => {
    for (const t of ['walk', 'run', 'hike', 'treadmill']) expect(supportsCadence(t)).toBe(true)
  })

  it('excludes activities with no step rate, even distance-based ones', () => {
    // Pedal cadence partly overlaps the search band, so cycling would otherwise be shown a
    // confident meaningless number — the failure mode this set exists to prevent.
    for (const t of ['cycle', 'swim', 'yoga', 'stretch', 'hiit', 'other']) {
      expect(supportsCadence(t)).toBe(false)
    }
  })

  it('excludes unknown and missing types', () => {
    expect(supportsCadence('custom-thing')).toBe(false)
    expect(supportsCadence(null)).toBe(false)
    expect(supportsCadence(undefined)).toBe(false)
  })
})

describe('compareCadence', () => {
  it('agrees when the two sources are close', () => {
    const cmp = compareCadence(170, 174)!
    expect(cmp.agree).toBe(true)
    expect(cmp.octaveMismatch).toBe(false)
    expect(cmp.deltaSpm).toBe(-4)
  })

  it('disagrees when they are far apart', () => {
    expect(compareCadence(170, 140)!.agree).toBe(false)
  })

  it('flags a ~2x split as an octave/units mismatch — the signature of a wrong ring factor', () => {
    const cmp = compareCadence(85, 170)!
    expect(cmp.agree).toBe(false)
    expect(cmp.octaveMismatch).toBe(true)
  })

  it('returns null for missing or non-positive readings', () => {
    expect(compareCadence(0, 170)).toBeNull()
    expect(compareCadence(170, Number.NaN)).toBeNull()
  })
})

// The strap DSP was suspected of a cadence-dependent scale error after three counted walks
// showed strap/counted ratios of 1.00 / 1.04 / 1.08 at 64 / 96 / 114 spm. A metronome-referenced
// capture cleared it (both sensors read ~117 against a set 120 bpm, i.e. the STEPPING was 2%
// behind, not the sensors), and this sweep is the standing proof: if a scale term ever appears
// in the detector, the error column stops being flat.
describe('detectCadence has no cadence-dependent scale error', () => {
  // Deliberately not a sine. A sine has no harmonics, and harmonic structure is exactly what a
  // parabolic autocorrelation fit can be biased by — so a sine would prove nothing about gait.
  function gaitSignal(trueSpm: number, sampleRate: number, seconds: number, seed = 1): number[] {
    const stepHz = trueSpm / 60
    const n = Math.round(sampleRate * seconds)
    let s = seed
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5 }
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate
      const ph = (t * stepHz) % 1
      const primary = Math.exp(-Math.pow((ph - 0.25) / 0.10, 2)) * 620
      const secondary = Math.exp(-Math.pow((ph - 0.65) / 0.13, 2)) * 300
      // Left/right asymmetry, which is what creates a stride harmonic to mis-lock onto.
      const stride = Math.floor(t * stepHz) % 2 === 0 ? 1.0 : 0.88
      out.push(700 + (primary + secondary) * stride + rnd() * 40)
    }
    return out
  }

  it('is accurate within 1% from slow walk to running cadence', () => {
    for (const truth of [64, 80, 96, 102, 114, 120, 130, 150, 170]) {
      const est = detectCadence(gaitSignal(truth, 50, 6), 50)
      expect(est, `no reading at ${truth} spm`).not.toBeNull()
      const errPct = Math.abs((est!.cadenceSpm - truth) / truth) * 100
      expect(errPct, `${truth} spm -> ${est!.cadenceSpm}`).toBeLessThan(1)
    }
  })

  it('does not drift with cadence — the error at 170 matches the error at 64', () => {
    const err = (truth: number) => {
      const est = detectCadence(gaitSignal(truth, 50, 6), 50)!
      return (est.cadenceSpm - truth) / truth
    }
    // A scale error would grow with cadence; a flat offset would not. The observed 1.00->1.08
    // ratio drift would show up here as ~8 percentage points of spread.
    expect(Math.abs(err(170) - err(64))).toBeLessThan(0.01)
  })

  it('is stable across window offsets at 120 spm (the metronome reference point)', () => {
    const full = gaitSignal(120, 50, 60)
    const win = 6 * 50
    const vals: number[] = []
    for (let off = 0; off + win <= full.length; off += 25) {
      const est = detectCadence(full.slice(off, off + win), 50)
      if (est) vals.push(est.cadenceSpm)
    }
    expect(vals.length).toBeGreaterThan(50)
    expect(Math.min(...vals)).toBeGreaterThan(119)
    expect(Math.max(...vals)).toBeLessThan(121)
  })
})

describe('cadenceFieldsForSave (Q-47)', () => {
  it('writes null — not an empty array — when nothing was measured', () => {
    const summary = summarizeCadence([], 0)
    expect(summary.series).toEqual([])          // the in-memory shape is unchanged
    expect(cadenceFieldsForSave(summary)).toEqual({
      cadenceSpm: null,
      cadenceSeries: null,                      // ...but an empty jsonb column is not "has cadence"
      cadenceSource: null,
    })
  })

  it('writes null for every column when there is no summary at all', () => {
    expect(cadenceFieldsForSave(null)).toEqual({ cadenceSpm: null, cadenceSeries: null, cadenceSource: null })
    expect(cadenceFieldsForSave(undefined)).toEqual({ cadenceSpm: null, cadenceSeries: null, cadenceSource: null })
  })

  it('passes a real summary through untouched', () => {
    const readings = [
      { atMs: 1_000, spm: 120, source: 'strap' as const },
      { atMs: 12_000, spm: 122, source: 'strap' as const },
    ]
    const fields = cadenceFieldsForSave(summarizeCadence(readings, 0))
    expect(fields.cadenceSpm).toBe(121)
    expect(fields.cadenceSource).toBe('strap')
    expect(fields.cadenceSeries).toHaveLength(2)
  })
})

// Q-230. The owner: "we [have] spm we should be able to get steps count right?" They were right —
// the binned cadence series was already persisted on every walk, and integrating it is a genuine
// step estimate from data the app had all along. `steps` was hardcoded null at every save site.
describe('summarizeCadence — the step estimate (Q-230)', () => {
  const START = 1_700_000_000_000
  const at = (sec: number, spm: number, source: 'strap' | 'ring' = 'strap') =>
    ({ atMs: START + sec * 1000, spm, source })

  it('integrates spm over the bins that have readings', () => {
    // Six 10 s bins at a steady 120 spm = one minute of walking = 120 steps.
    const readings = Array.from({ length: 6 }, (_, i) => at(i * 10, 120))
    expect(summarizeCadence(readings, START).stepsEstimate).toBe(120)
  })

  it('counts only the bins that have readings, so a pause does not inflate the total', () => {
    // Two bins of walking, then a gap, then one more: three bins, not the whole elapsed span.
    const readings = [at(0, 120), at(10, 120), at(600, 120)]
    expect(summarizeCadence(readings, START).stepsEstimate).toBe(60)
  })

  // The gate the entry asked for, and the reason it is per reading rather than per activity: it has
  // to keep being right the day RING_CADENCE_VALIDATED flips and a single walk can mix sources.
  it('ignores ring readings even when they outnumber the strap ones', () => {
    const readings = [at(0, 120), at(10, 200, 'ring'), at(20, 200, 'ring'), at(30, 200, 'ring')]
    const summary = summarizeCadence(readings, START)
    expect(summary.source).toBe('ring')          // ring contributed the most readings…
    expect(summary.stepsEstimate).toBe(20)       // …and contributed nothing to the step count
  })

  it('is null when nothing came from the strap', () => {
    expect(summarizeCadence([at(0, 160, 'ring')], START).stepsEstimate).toBeNull()
  })

  it('is null when there are no readings at all', () => {
    expect(summarizeCadence([], START).stepsEstimate).toBeNull()
  })

  // A mis-locked harmonic must not double the step count, for the same reason it must not move the
  // average — the series already uses the median per bin and the estimate reads that same value.
  it('uses the per-bin median, so one harmonic mis-lock cannot double the count', () => {
    const readings = [at(0, 60), at(1, 60), at(2, 121)]
    expect(summarizeCadence(readings, START).stepsEstimate).toBe(10)
  })
})
