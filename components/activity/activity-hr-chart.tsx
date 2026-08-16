'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@trainingai/shared/chart-colors'
import { phaseBandsPlugin, type PhaseBand } from './phase-bands-plugin'

export type { PhaseBand }

ChartJS.register(LineElement, PointElement, LinearScale, Filler, Tooltip, phaseBandsPlugin)

interface Reading {
  timestamp: string
  bpm: number
}

interface Props {
  readings: Reading[]
  avgHr: number | null
  maxHr: number | null
  /** Optional fast/slow phase shading (guided walk only — regular activities omit this). */
  phaseBands?: PhaseBand[]
}

function toElapsedMin(timestamp: string, startMs: number): number {
  return (new Date(timestamp).getTime() - startMs) / 60_000
}

export function ActivityHrChart({ readings, avgHr, maxHr, phaseBands }: Props) {
  const points = useMemo(() => {
    if (readings.length === 0) return []
    const startMs = new Date(readings[0].timestamp).getTime()
    return readings.map(r => ({ x: toElapsedMin(r.timestamp, startMs), y: r.bpm }))
  }, [readings])

  if (points.length === 0) return null

  const yMin = Math.max(0, Math.min(...points.map(p => p.y)) - 10)
  const yMax = Math.max(...points.map(p => p.y)) + 10
  const totalMin = points[points.length - 1].x

  const data: ChartData<'line'> = {
    datasets: [{
      data: points,
      borderColor: 'rgba(239, 68, 68, 0.85)',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      pointRadius: 0,
      fill: true,
      tension: 0.4,
      borderWidth: 2,
    }],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      tooltip: { enabled: false },
      legend: { display: false },
      ...(phaseBands && phaseBands.length > 0 ? {
        phaseBands: {
          bands: phaseBands,
          fastColor: resolveColor('var(--color-brand)'),
          slowColor: resolveColor('var(--muted-foreground)'),
        },
      } : {}),
    },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: Math.ceil(totalMin),
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 5,
          callback: v => `${Math.round(Number(v))}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
      y: {
        min: yMin,
        max: yMax,
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Heart Rate</p>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          {avgHr != null && <span>avg <span className="font-semibold text-foreground">{avgHr}</span></span>}
          {maxHr != null && <span>max <span className="font-semibold text-foreground">{maxHr}</span></span>}
        </div>
      </div>
      <div className="h-24 w-full">
        <Line data={data} options={options} />
      </div>
    </div>
  )
}
