/**
 * The "where does this reading sit against your recent days" maths behind the Heart & Recovery
 * range bars. One copy for both apps: the web `MetricScale` and the native range bar read it.
 */

export interface RangeStats {
  min: number | null
  avg: number | null
  max: number | null
}

/** {min, avg, max} over a list of nullable numbers, or nulls if there is nothing finite in it. */
export function rangeStats(values: (number | null | undefined)[]): RangeStats {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return { min: null, avg: null, max: null }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const avg = nums.reduce((s, v) => s + v, 0) / nums.length
  return { min, avg, max }
}

/** Which end of the range is healthy: 'high' = up is better (HRV, SpO₂), 'low' = down is better
 *  (resting HR), 'mid' = a middle sweet spot. */
export type RangeOptimal = 'low' | 'high' | 'mid'
export type RangeZoneBand = 'bad' | 'warn' | 'good'

/** The coloured zones painted behind the track, as widths summing to 100. */
export function rangeZones(optimal: RangeOptimal): { widthPct: number; band: RangeZoneBand }[] {
  const z = (widthPct: number, band: RangeZoneBand) => ({ widthPct, band })
  return optimal === 'high'
    ? [z(50, 'bad'), z(20, 'warn'), z(30, 'good')]
    : optimal === 'low'
      ? [z(30, 'good'), z(20, 'warn'), z(50, 'bad')]
      : [z(22, 'bad'), z(13, 'warn'), z(30, 'good'), z(13, 'warn'), z(22, 'bad')]
}

/**
 * Where the value and the average sit along the track, as 0-100 positions. The track always spans
 * the value as well as min/max, so a value outside the recent range still lands on it. Null when
 * there is no range to place the value against.
 */
export function rangePositions(
  value: number | null,
  min: number | null,
  max: number | null,
  avg?: number | null,
): { pos: number; avgPos: number | null } | null {
  if (value == null || min == null || max == null) return null
  const lo = Math.min(min, value)
  const hi = Math.max(max, value)
  const span = hi - lo
  const clamp = (n: number) => Math.max(0, Math.min(100, n))
  return {
    pos: clamp(span > 0 ? ((value - lo) / span) * 100 : 50),
    avgPos: avg != null && span > 0 ? clamp(((avg - lo) / span) * 100) : null,
  }
}
