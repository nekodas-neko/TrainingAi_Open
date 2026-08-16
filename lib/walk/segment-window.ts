/**
 * Filters an array of timestamped items to a `[fromMs, toMs)` window — shared by both the
 * per-segment HR filter and the per-segment GPS-point filter in the guided-walk summary
 * (same windowing logic, two different sample shapes).
 */
export function samplesInWindow<T>(
  samples: T[],
  getTimeMs: (item: T) => number,
  fromMs: number,
  toMs: number,
): T[] {
  return samples.filter(s => {
    const t = getTimeMs(s)
    return t >= fromMs && t < toMs
  })
}
