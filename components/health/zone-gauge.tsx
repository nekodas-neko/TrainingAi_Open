'use client'

/**
 * A health-metric gauge that shows the *golden zone* and a "you are here" marker, rather than a
 * fill bar (which wrongly implies more-is-always-better). Two shapes:
 *  - `toward-high`: the healthy zone is the top of the range (most 0–100 sub-scores — a high score
 *     means a healthy state). Zones: low → moderate → optimal.
 *  - `centered`: the healthy zone is the middle and both ends are bad (e.g. body-temperature
 *     deviation). Zones: low → ideal → high.
 * The marker sits at `pct` (0–100 across the track).
 */
export function ZoneGauge({
  pct,
  variant = 'toward-high',
  lowLabel,
  midLabel,
  highLabel,
}: {
  pct: number
  variant?: 'toward-high' | 'centered'
  lowLabel?: string
  midLabel?: string
  highLabel?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  // [widthPct, color] segments left→right. Optimal zone is the brighter green.
  const segments: Array<[number, string]> =
    variant === 'centered'
      ? [[20, 'var(--destructive)'], [12, 'var(--accent-amber)'], [36, 'var(--accent-green)'], [12, 'var(--accent-amber)'], [20, 'var(--destructive)']]
      : [[50, 'var(--destructive)'], [20, 'var(--accent-amber)'], [30, 'var(--accent-green)']]
  const labels =
    variant === 'centered'
      ? [lowLabel ?? 'Low', midLabel ?? 'Ideal', highLabel ?? 'High']
      : [lowLabel ?? 'Needs work', midLabel ?? '', highLabel ?? 'Optimal']

  return (
    <div className="mt-2">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          {segments.map(([w, c], i) => (
            <div key={i} style={{ width: `${w}%`, background: `color-mix(in oklch, ${c} 32%, transparent)` }} />
          ))}
        </div>
        {/* "you are here" marker */}
        <div
          className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `${clamped}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>{labels[0]}</span>
        <span className="text-green-600 dark:text-green-400 font-medium">{variant === 'centered' ? labels[1] : ''}</span>
        <span className={variant === 'centered' ? '' : 'text-green-600 dark:text-green-400 font-medium'}>{labels[2]}</span>
      </div>
    </div>
  )
}
