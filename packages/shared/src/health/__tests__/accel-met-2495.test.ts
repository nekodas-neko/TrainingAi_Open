// Issue 2495. Per-minute MET from the ring's raw accelerometer, kept out of the cascade until
// calibrated against the ring's own MET:
//   · intensity is scale-free (the raw-count g-scale is unknown): scaling every count leaves it alone;
//   · a still minute reads ~0, a moving one more, and a thinly covered minute is dropped;
//   · the fit recovers a known line, and the report scores each day with a model that never saw it.
import { describe, it, expect } from 'vitest'
import {
  accelMinuteIntensity, accelMetPoints, fitAccelMetModel, pairWithDeviceMet, accelMetCalibration,
  type AccelChunk,
} from '../accel-met'
import { minuteMeanCandidates } from '../../inputs/adapters'

const T0 = Date.UTC(2026, 9, 1, 0, 0, 0)
const RATE = 50
/** `minutes` of samples: gravity `g` counts, with a ±`amp` square wave on top. */
function chunk(startMs: number, minutes: number, g: number, amp: number): AccelChunk {
  const n = minutes * 60 * RATE
  return { startedAtMs: startMs, sampleRate: RATE, magnitudes: Array.from({ length: n }, (_, i) => g + (i % 2 ? amp : -amp)) }
}

describe('accelMinuteIntensity', () => {
  it('reads a still minute as ~0 and a moving one as its amplitude in g', () => {
    const still = accelMinuteIntensity([chunk(T0, 1, 1000, 0)])
    const moving = accelMinuteIntensity([chunk(T0, 1, 1000, 300)])
    expect(still[0].intensity).toBeCloseTo(0, 6)
    expect(moving[0].intensity).toBeCloseTo(0.3, 2)
  })

  it('does not depend on the unknown counts-per-g scale', () => {
    const a = accelMinuteIntensity([chunk(T0, 2, 1000, 200)])
    const b = accelMinuteIntensity([chunk(T0, 2, 4096, 819.2)])
    expect(a.map(m => m.intensity)).toEqual(b.map(m => expect.closeTo(m.intensity, 6)))
  })

  it('drops a minute the stream barely covered, and a chunk too short to estimate gravity', () => {
    const partial = { ...chunk(T0 + 50_000, 1, 1000, 100) }   // 10 s in minute 0, 50 s in minute 1
    const mins = accelMinuteIntensity([partial])
    expect(mins.map(m => m.slot)).toEqual([T0 + 60_000])
    expect(accelMinuteIntensity([{ startedAtMs: T0, sampleRate: RATE, magnitudes: [1000, 1100, 900] }])).toEqual([])
  })

  it('feeds the cascade\'s minute-mean adapter as accel_met', () => {
    const pts = accelMetPoints(accelMinuteIntensity([chunk(T0, 1, 1000, 100)]), { intercept: 1, slope: 10 })
    const c = minuteMeanCandidates(pts, 'accel_met', 'oura-accel')
    expect(c).toEqual([{ slot: T0, value: expect.closeTo(2, 6), route: 'accel_met', source: 'oura-accel' }])
  })
})

describe('calibration against device_met', () => {
  // Three days; device MET is exactly 1.2 + 8 × intensity, so the fit must find that line.
  const minutes = Array.from({ length: 90 }, (_, i) => ({
    slot: T0 + Math.floor(i / 30) * 86_400_000 + (i % 30) * 60_000, intensity: (i % 30) / 30, samples: 3000,
  }))
  const device = new Map(minutes.map(m => [m.slot, 1.2 + 8 * m.intensity]))
  // A day key is all the split needs; the slots are built on UTC day boundaries.
  const dayOf = (slot: number) => String(Math.floor(slot / 86_400_000))

  it('pairs by minute and recovers a known line', () => {
    const pairs = pairWithDeviceMet(minutes, device)
    expect(pairs).toHaveLength(90)
    const m = fitAccelMetModel(pairs)!
    expect(m.intercept).toBeCloseTo(1.2, 6)
    expect(m.slope).toBeCloseTo(8, 6)
  })

  it('scores each day out of sample and beats the mean-only baseline', () => {
    const r = accelMetCalibration(pairWithDeviceMet(minutes, device), dayOf)
    expect(r.days).toBe(3)
    expect(r.heldOut.n).toBe(90)
    expect(r.heldOut.mae).toBeLessThan(1e-6)
    expect(r.baseline.mae).toBeGreaterThan(1)
    expect(r.byBand.reduce((s, b) => s + b.n, 0)).toBe(90)
  })

  it('has no model to offer from fewer than two distinct intensities', () => {
    expect(fitAccelMetModel([{ slot: T0, intensity: 0.1, deviceMet: 2 }])).toBeNull()
  })
})
