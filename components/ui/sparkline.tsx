'use client'

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
}

export function Sparkline({
  values, width = 120, height = 40, color = 'var(--color-brand)',
  showDots = false, fill = false, responsive = false, times, timeDomain,
}: SparklineProps) {
  if (values.length < 2) return null
  const min = Math.min(...values) - 0.5
  const max = Math.max(...values) + 0.5
  const range = max - min || 1
  const byTime = times && times.length === values.length && timeDomain
  const [domainMin, domainMax] = timeDomain ?? [0, 1]
  const domainRange = domainMax - domainMin || 1
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => ({
    x: byTime ? ((times![i] - domainMin) / domainRange) * width : i * step,
    y: height - ((v - min) / range) * (height * 0.8) - height * 0.1,
  }))
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
            points={`0,${height} ${line} ${width},${height}`}
            fill={`url(#${gradId})`}
          />
        </>
      )}
      <polyline
        points={line}
        fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {showDots && pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />
      ))}
    </svg>
  )
}
