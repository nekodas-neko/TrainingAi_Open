/**
 * Live realtime-accelerometer decoding + step peak-counting (Tier 2 of the step plan).
 *
 * `SetRealtime(ACM)` (plugin `startAccel`) makes the ring stream live accelerometer
 * frames as command-tag `0x33` — NOT the entitlement-locked RData path. Frame layout
 * (open_oura client.rs): `[0]=0x33 [1]=len [2]=sampleRate [3]=seq` then consecutive
 * 6-byte samples (x, y, z — each i16 LE raw counts, ~2 samples/frame). The native
 * service already bridges every frame to JS (`ouraFrames`), so this path is pure JS.
 *
 * ⚠️ SPIKE STATUS: the 0x33 stream is UNPROVEN on our ring until tried worn+moving
 * on-device, the raw-count g-scale is unpinned upstream, and the sampleRate byte's
 * semantics are unconfirmed — the peak-counter constants are first guesses to be tuned
 * from the tester's live readout. The stream is firmware time-boxed (~5 min per
 * SetRealtime) and must be re-armed by the caller while a live count is running.
 */

export interface AccelSample {
  x: number
  y: number
  z: number
  /** √(x²+y²+z²) in raw counts. */
  magnitude: number
}

export interface AccelFrame {
  sampleRate: number
  seq: number
  samples: AccelSample[]
}

export const ACCEL_FRAME_TAG = 0x33

/** Decode a raw 0x33 frame (full frame bytes, header included). Infallible: returns
 *  null for anything malformed. */
export function decodeAccelFrame(frame: Uint8Array): AccelFrame | null {
  if (frame.length < 10 || frame[0] !== ACCEL_FRAME_TAG) return null
  const samples: AccelSample[] = []
  for (let i = 4; i + 6 <= frame.length; i += 6) {
    const i16 = (lo: number, hi: number) => {
      const v = lo | (hi << 8)
      return v > 0x7fff ? v - 0x10000 : v
    }
    const x = i16(frame[i], frame[i + 1])
    const y = i16(frame[i + 2], frame[i + 3])
    const z = i16(frame[i + 4], frame[i + 5])
    samples.push({ x, y, z, magnitude: Math.sqrt(x * x + y * y + z * z) })
  }
  if (samples.length === 0) return null
  return { sampleRate: frame[2], seq: frame[3], samples }
}

/** EMA smoothing factor for the gravity/DC baseline. */
export const BASELINE_ALPHA = 0.08
/** A sample is peak material when magnitude exceeds baseline × (1 + this). Relative,
 *  because the raw-count g-scale is unknown. */
export const PEAK_RATIO = 0.12
/** Minimum time between counted steps (refractory). On-device calibration 2026-07-10:
 *  the rate byte reads 50 (= Hz — 2 samples/frame lined up with wall-clock), and the
 *  original fixed 8-sample refractory was only 160 ms there, letting a stride's double
 *  peak count twice (100 real steps → 125 counted). 350 ms kills the double-count while
 *  still allowing ~2.8 steps/sec. */
export const MIN_STEP_GAP_SEC = 0.35
/** Fallback refractory in samples when no valid rate byte has been seen. */
export const MIN_STEP_GAP_SAMPLES = 8

/**
 * Streaming step counter over the live accel magnitude: EMA baseline, count a
 * rising→falling turning point that clears the relative threshold, refractory-gated.
 * Reads zero when still — idle needs no special handling.
 */
export class StepPeakCounter {
  count = 0
  samplesSeen = 0
  /** Latest magnitude/baseline, surfaced by the tester for on-device tuning. */
  lastMagnitude = 0
  baseline = 0

  private prevDeviation = 0
  private rising = false
  private lastPeakAt = -Infinity
  private refractorySamples = MIN_STEP_GAP_SAMPLES
  private sampleRateHz: number | null = null

  /** Derive the time-based refractory from the stream's rate byte (Hz). */
  setSampleRate(hz: number): void {
    if (Number.isFinite(hz) && hz > 0 && hz <= 200) {
      this.sampleRateHz = hz
      this.refractorySamples = Math.max(MIN_STEP_GAP_SAMPLES, Math.round(hz * MIN_STEP_GAP_SEC))
    }
  }

  /**
   * Seconds of accelerometer stream this counter has actually processed — `null` until a rate byte
   * has been seen.
   *
   * This is the ONLY duration `count` may be divided by. The 2026-07-28 step over-count came from
   * pairing `count` with a window whose end was derived from the *gate* stream (0x7e/0x7f), which
   * stalls whenever the ring power-gates its radio: 3,605 real steps were posted over a 12.5-minute
   * window they needed 21 minutes to produce. The refractory bounds cadence per SAMPLE, so a count
   * is only ever meaningful against the samples behind it.
   */
  get elapsedSec(): number | null {
    return this.sampleRateHz != null ? this.samplesSeen / this.sampleRateHz : null
  }

  add(magnitude: number): void {
    this.samplesSeen++
    this.lastMagnitude = magnitude
    if (this.baseline === 0) {
      this.baseline = magnitude
      return
    }
    this.baseline += BASELINE_ALPHA * (magnitude - this.baseline)
    const threshold = this.baseline * PEAK_RATIO
    const deviation = magnitude - this.baseline
    if (deviation > this.prevDeviation) {
      this.rising = deviation > threshold
    } else if (this.rising) {
      // Turning point just passed above threshold → one step, if out of refractory.
      this.rising = false
      if (this.samplesSeen - this.lastPeakAt >= this.refractorySamples) {
        this.count++
        this.lastPeakAt = this.samplesSeen
      }
    }
    this.prevDeviation = deviation
  }

  addFrame(frame: AccelFrame): void {
    this.setSampleRate(frame.sampleRate)
    for (const s of frame.samples) this.add(s.magnitude)
  }

  reset(): void {
    this.count = 0
    this.samplesSeen = 0
    this.lastMagnitude = 0
    this.baseline = 0
    this.prevDeviation = 0
    this.rising = false
    this.lastPeakAt = -Infinity
    this.refractorySamples = MIN_STEP_GAP_SAMPLES
    this.sampleRateHz = null
  }
}
