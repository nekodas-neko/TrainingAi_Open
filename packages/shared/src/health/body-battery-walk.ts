// The Body Battery integration loop, lifted verbatim out of `app/api/body-battery/route.ts`.
//
// It lived inline in a ~200-line async function that also does eight DB reads, anchor resolution
// and the daytime-stress fit, so the arithmetic could not be driven without a database. TN-2 asks
// for the charge-window offset to be "fitted against the shipped TypeScript, not against [a SQL
// replay] table" — which is only possible once the shipped arithmetic is callable on its own. That
// is what this file is for.
//
// **Behaviour is deliberately unchanged.** Every constant stays a parameter rather than being
// re-declared here, so the route remains the single place they are chosen and this cannot silently
// drift from them. `body-battery-walk.test.ts` pins the shape against hand-computed values.

/** One heart-rate sample. `tsMs` is epoch milliseconds. */
export interface BatteryWalkSample {
  tsMs: number
  bpm: number
}

export interface BatteryWalkPoint {
  t: number
  v: number
}

export interface BatteryWalkParams {
  /** Battery level at wake, 0–100. */
  anchor: number
  /** Epoch ms the walk starts from. Samples at or after this are integrated. */
  wakeTime: number
  restingHr: number
  /** `hrMax − restingHr`. Never zero — the caller resolves it. */
  reserve: number
  /**
   * Reserve fraction at or under which the tank charges rather than drains.
   *
   * TN-2's change lands here: an explicit bpm offset above resting HR becomes
   * `offsetBpm / reserve`, which keeps this function's shape identical while making the boundary
   * immune to `hrMax` re-estimation. Nothing in this file needs to change for that.
   */
  restThreshold: number
  /** Battery points per minute at full rest. */
  chargeRate: number
  /** Battery points per minute per unit reserve over the threshold. */
  drainRate: number
  /** Battery points per minute at a full (100%) below-baseline stress deviation. */
  stressDrainRate: number
  /** Gaps longer than this hold the level steady — the ring is not being worn. */
  gapHoldMin: number
  /** Per-sample dt clamp, so sparse data cannot spike a single delta. */
  sampleCapMin: number
  /**
   * Daytime stress level ∈ [−1, +1] at a moment, or null when unknown. Only negative values (below
   * baseline = stressed) add drain. A route with no stress series passes `() => null`, which is
   * exactly what an empty series already produced.
   */
  stressAt: (ms: number) => number | null
}

export interface BatteryWalkResult {
  /** Final level, 0–100, unrounded. */
  battery: number
  charged: number
  drained: number
  stressDrained: number
  /** The rendered curve, starting at `wakeTime` and rounded per point as the chart consumes it. */
  series: BatteryWalkPoint[]
  /** Samples that actually drove the arc — `0` means the day is unmeasured, not calm. */
  sampleCount: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Walk the heart-rate series from wake forward, charging below the rest threshold and draining
 * above it, with daytime stress adding drain on top.
 *
 * `samples` must be ascending by `tsMs`; the caller already reads them ordered. Samples before
 * `wakeTime` are ignored, so the caller may pass the whole day.
 */
export function walkBodyBattery(
  samples: BatteryWalkSample[],
  p: BatteryWalkParams,
): BatteryWalkResult {
  let battery = p.anchor
  let charged = 0
  let drained = 0
  let stressDrained = 0
  const series: BatteryWalkPoint[] = [{ t: p.wakeTime, v: Math.round(battery) }]

  const waking = samples.filter(s => s.tsMs >= p.wakeTime)
  let prevMs = p.wakeTime
  for (const s of waking) {
    const dtMin = (s.tsMs - prevMs) / 60_000
    prevMs = s.tsMs
    if (dtMin <= 0) continue
    if (dtMin > p.gapHoldMin) {
      // Ring off / no data — hold steady but keep the timeline continuous.
      series.push({ t: s.tsMs, v: Math.round(battery) })
      continue
    }
    const dt = Math.min(dtMin, p.sampleCapMin)
    const hrr = clamp((s.bpm - p.restingHr) / p.reserve, 0, 1)
    let delta: number
    if (hrr <= p.restThreshold) {
      delta = p.chargeRate * (1 - hrr / p.restThreshold) * dt
      charged += delta
    } else {
      delta = -p.drainRate * (hrr - p.restThreshold) * dt
      drained += -delta
    }
    // Oura's stress level is already normalized to [−1,0) when stressed, so drain scales directly
    // by its magnitude.
    const rs = p.stressAt(s.tsMs)
    if (rs != null && rs < 0) {
      const extra = p.stressDrainRate * -rs * dt
      delta -= extra
      drained += extra
      stressDrained += extra
    }
    battery = clamp(battery + delta, 0, 100)
    series.push({ t: s.tsMs, v: Math.round(battery) })
  }

  return { battery, charged, drained, stressDrained, series, sampleCount: waking.length }
}
