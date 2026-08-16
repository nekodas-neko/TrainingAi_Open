import { describe, it, expect } from 'vitest'
import { decodeAccelFrame, StepPeakCounter, ACCEL_FRAME_TAG } from '../oura-ble/accel'

describe('decodeAccelFrame (0x33 realtime accel)', () => {
  it('decodes header + two i16 LE samples', () => {
    // tag, len, sampleRate=26, seq=7 · s1=(100, -200, 300) · s2=(-1, 2, 32767)
    const f = new Uint8Array([
      0x33, 0x10, 26, 7,
      0x64, 0x00, 0x38, 0xff, 0x2c, 0x01,
      0xff, 0xff, 0x02, 0x00, 0xff, 0x7f,
    ])
    const d = decodeAccelFrame(f)!
    expect(d.sampleRate).toBe(26)
    expect(d.seq).toBe(7)
    expect(d.samples).toHaveLength(2)
    expect(d.samples[0]).toMatchObject({ x: 100, y: -200, z: 300 })
    expect(d.samples[1]).toMatchObject({ x: -1, y: 2, z: 32767 })
    expect(d.samples[0].magnitude).toBeCloseTo(Math.sqrt(100 ** 2 + 200 ** 2 + 300 ** 2))
  })

  it('rejects wrong tag, short frames, and header-only frames', () => {
    expect(decodeAccelFrame(new Uint8Array([0x80, 0x02, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(decodeAccelFrame(new Uint8Array([ACCEL_FRAME_TAG, 0x02, 1, 2]))).toBeNull()
    expect(decodeAccelFrame(new Uint8Array([]))).toBeNull()
  })
})

describe('StepPeakCounter', () => {
  it('counts one step per distinct magnitude bump and none when still', () => {
    const counter = new StepPeakCounter()
    // Still baseline: constant magnitude — no steps.
    for (let i = 0; i < 100; i++) counter.add(4000)
    expect(counter.count).toBe(0)

    // 10 arm-swing-like bumps (+900 over 4 samples), 20 flat samples apart.
    for (let bump = 0; bump < 10; bump++) {
      for (const v of [4300, 4900, 4900, 4300]) counter.add(v)
      for (let i = 0; i < 20; i++) counter.add(4000)
    }
    expect(counter.count).toBe(10)
  })

  it('refractory suppresses double-counting within one stride', () => {
    const counter = new StepPeakCounter()
    for (let i = 0; i < 50; i++) counter.add(4000)
    // Two peaks 3 samples apart — inside MIN_STEP_GAP_SAMPLES — count once.
    for (const v of [4900, 4000, 4900, 4000]) counter.add(v)
    for (let i = 0; i < 20; i++) counter.add(4000)
    expect(counter.count).toBe(1)
  })

  it('at the real 50 Hz rate, a stride double-peak inside 350 ms counts once', () => {
    // On-device calibration 2026-07-10: rate byte 50 (Hz); with the old fixed 8-sample
    // refractory a stride's double peak counted twice (100 real → 125 counted).
    const counter = new StepPeakCounter()
    counter.setSampleRate(50) // refractory → round(50 × 0.35) = 18 samples
    for (let i = 0; i < 50; i++) counter.add(1000)
    // Two peaks 10 samples (200 ms) apart — one stride's double peak → one step.
    counter.add(1300); counter.add(1000)
    for (let i = 0; i < 8; i++) counter.add(1000)
    counter.add(1300); counter.add(1000)
    for (let i = 0; i < 20; i++) counter.add(1000)
    expect(counter.count).toBe(1)
    // A peak a full stride later (>18 samples) counts as the next step.
    counter.add(1300); counter.add(1000)
    for (let i = 0; i < 10; i++) counter.add(1000)
    expect(counter.count).toBe(2)
  })

  it('reset clears all streaming state', () => {
    const counter = new StepPeakCounter()
    for (let i = 0; i < 30; i++) counter.add(4000)
    counter.add(4900); counter.add(4000)
    expect(counter.count).toBe(1)
    counter.reset()
    expect(counter.count).toBe(0)
    expect(counter.samplesSeen).toBe(0)
  })
})
