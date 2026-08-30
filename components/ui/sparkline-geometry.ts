/**
 * Where a sparkline's points land — pulled out of the component so it can be tested (Q-154).
 *
 * The projection is the half of a sparkline that can be *wrong* rather than merely ugly, and both
 * vitest projects run in `node`, so a component that only exists as JSX cannot be driven at all.
 * `fitWithin` in `lib/media/downscale-image.ts` is split out for the same reason.
 *
 * The rule this exists to hold: **`valuePadding` changes what the chart says.** At the default 0.5
 * a 0.5 kg body-weight spread renders at half its true amplitude, which is why Q-154 refused a
 * blind conversion of the callers that need exact min/max.
 */
export interface SparklineGeometry {
  values: number[]
  width: number
  height: number
  /** Parallel to `values`. With `timeDomain`, x projects by time instead of by index. */
  times?: number[]
  timeDomain?: [number, number]
  /** Uniform inset on both axes. Absent keeps the original projection: x `0..width`, y at 10%/80%. */
  pad?: number
  /** Headroom above and below the data before scaling. `0` is exact min/max. */
  valuePadding: number
}

export function sparklinePoints(
  { values, width, height, times, timeDomain, pad, valuePadding }: SparklineGeometry,
): { x: number; y: number }[] {
  const min = Math.min(...values) - valuePadding
  const max = Math.max(...values) + valuePadding
  // A flat series has no range; 1 keeps the division defined and puts every point on one line.
  const range = max - min || 1

  const byTime = times && times.length === values.length && timeDomain
  const [domainMin, domainMax] = timeDomain ?? [0, 1]
  const domainRange = domainMax - domainMin || 1

  const innerWidth = pad != null ? width - pad * 2 : width
  const step = innerWidth / (values.length - 1)

  return values.map((v, i) => ({
    x: (byTime ? ((times![i] - domainMin) / domainRange) * innerWidth : i * step) + (pad ?? 0),
    y: pad != null
      ? height - pad - ((v - min) / range) * (height - pad * 2)
      : height - ((v - min) / range) * (height * 0.8) - height * 0.1,
  }))
}
