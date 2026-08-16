'use client'

import { useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Chart,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip)

interface HrReading {
  timestamp: string
  bpm: number
}

interface PaceSeriesPoint {
  tSec: number
  paceSec: number
}

interface Props {
  hrReadings: HrReading[]
  paceSeries: PaceSeriesPoint[]
  avgHr: number | null
  maxHr: number | null
  /** Fires with the scrubbed elapsed seconds, or null when the pointer leaves the chart. */
  onScrub: (tSec: number | null) => void
}

function toElapsedMin(timestamp: string, startMs: number): number {
  return (new Date(timestamp).getTime() - startMs) / 60_000
}

export function HeroActivityChart({ hrReadings, paceSeries, avgHr, maxHr, onScrub }: Props) {
  const chartRef = useRef<Chart<'line'> | null>(null)

  const hrPoints = useMemo(() => {
    if (hrReadings.length === 0) return []
    const startMs = new Date(hrReadings[0].timestamp).getTime()
    return hrReadings.map(r => ({ x: toElapsedMin(r.timestamp, startMs), y: r.bpm }))
  }, [hrReadings])

  const pacePoints = useMemo(
    () => paceSeries.map(p => ({ x: p.tSec / 60, y: p.paceSec })),
    [paceSeries],
  )

  const data: ChartData<'line'> = useMemo(() => ({
    datasets: [
      {
        label: 'Heart Rate',
        data: hrPoints,
        borderColor: 'rgba(239, 68, 68, 0.85)',
        backgroundColor: 'transparent',
        yAxisID: 'y',
        pointRadius: 0,
        tension: 0.4,
        borderWidth: 2,
      },
      {
        label: 'Pace',
        data: pacePoints,
        borderColor: resolveColor('var(--color-brand)'),
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        pointRadius: 0,
        tension: 0.4,
        borderWidth: 2,
      },
    ],
  }), [hrPoints, pacePoints])

  if (hrPoints.length === 0 && pacePoints.length === 0) return null

  const totalMin = Math.max(
    hrPoints.length ? hrPoints[hrPoints.length - 1].x : 0,
    pacePoints.length ? pacePoints[pacePoints.length - 1].x : 0,
  )

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { tooltip: { enabled: false }, legend: { display: false } },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: Math.ceil(totalMin) || 1,
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 5,
          callback: v => `${Math.round(Number(v))}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
      y: {
        position: 'left',
        ticks: { color: 'rgba(239, 68, 68, 0.85)', font: { size: 9 }, maxTicksLimit: 4 },
        grid: { display: false },
      },
      y1: {
        position: 'right',
        ticks: {
          color: resolveColor('var(--color-brand)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => `${Math.floor(Number(v) / 60)}:${String(Math.round(Number(v) % 60)).padStart(2, '0')}`,
        },
        grid: { display: false },
      },
    },
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current
    if (!chart) return
    const elements = chart.getElementsAtEventForMode(e.nativeEvent, 'index', { intersect: false }, true)
    if (elements.length === 0) return
    const point = data.datasets[elements[0].datasetIndex].data[elements[0].index] as { x: number }
    onScrub(Math.round(point.x * 60))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Heart Rate &amp; Pace</p>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          {avgHr != null && <span>avg <span className="font-semibold text-foreground">{avgHr}</span></span>}
          {maxHr != null && <span>max <span className="font-semibold text-foreground">{maxHr}</span></span>}
        </div>
      </div>
      <div
        className="h-32 w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onScrub(null)}
      >
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  )
}
