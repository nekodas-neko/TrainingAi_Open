// Extracted from hr-day-chart.tsx so this pure function can be unit-tested without
// pulling chart.js/JSX into the test transform (importing the .tsx component directly
// from a .ts test file fails vite's import-analysis in this repo's esbuild config).

// Insert a gap marker between two buckets that are more than `gapMin` apart so the
// line renders a visible break (ring power-gating leaves real coverage gaps) rather
// than interpolating a fake straight segment across missing data.
//
// The marker is a NaN-y point, NOT a bare `null`. chart.js chooses its parse path
// from the first element (always a real object here — the gap push is gated on i>0),
// so it parses the WHOLE dataset as {x,y} object data, which does `resolveObjectKey(item,'x')`
// → `item.x` on every element. A `null` element then throws "Cannot read properties
// of null (reading 'x')" during parse — the crash this once shipped with. `null`/
// undefined gaps are only valid for chart.js primitive/array data, never object data.
// A point with `y: NaN` breaks the line identically under `spanGaps: false` while
// still being a real object the parser can read `.x`/`.y` from.
export function withGapBreaks(points: { x: number; y: number }[], gapMin = 20): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  points.forEach((p, i) => {
    if (i > 0 && p.x - points[i - 1].x > gapMin) {
      out.push({ x: (points[i - 1].x + p.x) / 2, y: NaN })
    }
    out.push(p)
  })
  return out
}

// Opt-in exception to the no-fake-interpolation policy above: a SEPARATE point series
// that linearly bridges real coverage gaps, for callers that explicitly want an estimated
// line drawn across missing data. Never merge this into withGapBreaks's output — the real
// line must keep rendering an honest break; this produces a second, independently-styled
// dataset. Gaps larger than maxGapMin are left as a break in this series too: a straight
// line across many hours of missing data reads as more confident than the data supports.
export function interpolateGaps(
  points: { x: number; y: number }[],
  gapMin = 20,
  maxGapMin = 120,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  points.forEach((p, i) => {
    if (i === 0) return
    const prev = points[i - 1]
    const gap = p.x - prev.x
    if (gap > gapMin && gap <= maxGapMin) {
      out.push({ x: prev.x, y: prev.y })
      out.push({ x: p.x, y: p.y })
      out.push({ x: p.x, y: NaN }) // isolate this bridge segment from whatever follows
    }
  })
  return out
}
