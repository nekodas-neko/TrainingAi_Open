'use client'

/**
 * A horizontal scale showing where a single value sits within a recent range (min…max),
 * with an optional average tick. Reusable across sleep-night detail (#6) and the Heart &
 * Recovery widget (#7). Pure HTML/CSS so it is theme-safe and cheap to paint.
 *
 * Pass the value plus the min/max (and optional avg) of the comparison window; the caller
 * decides the window (e.g. last 14–30 nights). `format` renders the numbers; `accent` tints
 * the value marker. Returns null when there isn't enough range to place the value.
 */
export function MetricScale({
  label,
  value,
  min,
  max,
  avg,
  format = (v) => `${Math.round(v)}`,
  accent = 'var(--color-brand)',
  optimal,
}: {
  label: string
  value: number | null
  min: number | null
  max: number | null
  avg?: number | null
  format?: (v: number) => string
  accent?: string
  // Which end of the range is healthy — paints green/amber/red zones so it's clear which way is
  // good, matching the golden-zone gauges elsewhere. 'high' = up is better (HRV, SpO₂, efficiency),
  // 'low' = down is better (resting/lowest HR), 'mid' = a middle sweet spot (sleep duration).
  // Omit for a plain neutral track.
  optimal?: 'low' | 'high' | 'mid'
}) {
  if (value == null || min == null || max == null) return null
  const lo = Math.min(min, value)
  const hi = Math.max(max, value)
  const span = hi - lo
  const pos = span > 0 ? ((value - lo) / span) * 100 : 50
  const avgPos = avg != null && span > 0 ? ((avg - lo) / span) * 100 : null

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: accent }}>{format(value)}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted/60">
        {/* golden-zone colouring: green toward the healthy end (or the middle for 'mid') */}
        {optimal && (
          <div className="absolute inset-0 flex">
            {(optimal === 'high'
              ? [[50, '#ef4444'], [20, '#f59e0b'], [30, '#22c55e']]
              : optimal === 'low'
                ? [[30, '#22c55e'], [20, '#f59e0b'], [50, '#ef4444']]
                : [[22, '#ef4444'], [13, '#f59e0b'], [30, '#22c55e'], [13, '#f59e0b'], [22, '#ef4444']]
            ).map(([w, c], i) => (
              <div key={i} style={{ width: `${w}%`, background: `color-mix(in oklch, ${c} 30%, transparent)` }} />
            ))}
          </div>
        )}
        {/* average reference tick */}
        {avgPos != null && (
          <div
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-border"
            style={{ left: `${Math.max(0, Math.min(100, avgPos))}%` }}
            title="Your recent average"
          />
        )}
        {/* value marker */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
          style={{ left: `${Math.max(0, Math.min(100, pos))}%`, background: accent }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>{format(min)}</span>
        {avg != null && <span>avg {format(avg)}</span>}
        <span>{format(max)}</span>
      </div>
    </div>
  )
}

/** Convenience: compute {min, avg, max} over a list of nullable numbers, or nulls if empty. */
export function rangeStats(values: (number | null | undefined)[]): { min: number | null; avg: number | null; max: number | null } {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (nums.length === 0) return { min: null, avg: null, max: null }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const avg = nums.reduce((s, v) => s + v, 0) / nums.length
  return { min, avg, max }
}
