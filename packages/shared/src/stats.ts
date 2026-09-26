// Order statistics, once. Domain-neutral on purpose: health, workout and device code all need a
// median, and a copy in each is how they drift (LA-148 found six, one of which disagreed).
//
// The definitions here are the numpy ones, and both return `null` on an empty list rather than a
// number. That is the load-bearing part: the copy this module replaced in `health/hr-smoothing.ts`
// returned **0** for an empty list, and a zero bpm is a plausible-looking value rather than an
// obvious absence — which is exactly how a missing measurement becomes a displayed one.

/** Average of the two middle values on an even count. Empty → null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Linear-interpolated quantile, `q` in 0..1. Empty → null. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const idx = (s.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}
