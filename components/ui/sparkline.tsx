'use client'

import { sparklinePoints } from './sparkline-geometry'

interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  color?: string
  showDots?: boolean   // WeightSparkline/LeanMassSparkline style
  fill?: boolean       // StrengthTrendCard gradient-area style
  responsive?: boolean // stretch to the container's full width via CSS; `width` still drives the point-projection math
  // Parallel array to `values` — when given, points project by position within `timeDomain`
  // instead of by index, so a signal that only covers part of the domain renders with visible
  // gaps rather than being stretched to fill the full width.
  times?: number[]
  timeDomain?: [number, number]
  /**
   * Uniform inset on BOTH axes, in viewBox units (Q-154). When set it replaces the default
   * projection entirely — x spans `pad … width - pad` and y spans `pad … height - pad` — because
   * the two callers this exists for inset both axes by one number and the default's percentage
   * y-padding cannot express that. Absent, nothing changes for the 20 call sites that predate it.
   */
  pad?: number
  /**
   * Headroom added above and below the data before scaling. **The default of 0.5 is the reason a
   * blind conversion was refused (Q-154):** on a 0.5 kg body-weight spread it halves the visible
   * amplitude, which changes what the chart says rather than how it looks. Pass `0` for exact
   * min/max.
   */
  valuePadding?: number
  strokeWidth?: number
  /** Three faint horizontal rules — top, middle, baseline. */
  gridLines?: boolean
  /** Larger final dot. The non-final dots are NOT dimmed: the owner's 2026-08-25 call was that the
   *  callers accept one dot treatment rather than the primitive growing a prop per caller's art. */
  emphasizeLast?: boolean
  /** Already-formatted text drawn above the last point — units and rounding belong to the caller. */
  valueLabel?: string
}

export function Sparkline({
  values, width = 120, height = 40, color = 'var(--color-brand)',
  showDots = false, fill = false, responsive = false, times, timeDomain,
  pad, valuePadding = 0.5, strokeWidth = 1.5, gridLines = false, emphasizeLast = false, valueLabel,
}: SparklineProps) {
  if (values.length < 2) return null
  const pts = sparklinePoints({ values, width, height, times, timeDomain, pad, valuePadding })
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg
      width={responsive ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={responsive ? 'none' : undefined}
      className="overflow-visible"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`${pad ?? 0},${height} ${line} ${width - (pad ?? 0)},${height}`}
            fill={`url(#${gradId})`}
          />
        </>
      )}
      {gridLines && [0, height / 2, height].map(y => (
        <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="currentColor" strokeOpacity="0.04" strokeWidth="1" />
      ))}
      <polyline
        points={line}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round"
      />
      {showDots && pts.map((p, i) => (
        <circle
          key={i} cx={p.x} cy={p.y}
          r={emphasizeLast && i === pts.length - 1 ? 4 : 2.5}
          fill={color}
        />
      ))}
      {valueLabel && (
        <text
          x={pts[pts.length - 1].x} y={pts[pts.length - 1].y - 8}
          textAnchor="middle" fill={color} fontSize="10" fontWeight="700"
        >
          {valueLabel}
        </text>
      )}
    </svg>
  )
}
